/*
  Nano Writable Stream
   - Made By NSI (NoSecretImprove#5809)
*/

let defaultStreamState = {
  header: Buffer.alloc(8),
  headerLength: 0,
  message_type: null,
  version: null,
  extensions: null,
  bodySize: 0,
  expectedBodySize: null,
  body: null,
}

const blockSizes = {
  0x00: 0,   // Invalid
  0x01: 0,   // Not A Block (NaB)
  0x02: 152, // Send (Legacy)
  0x03: 136, // Receive (Legacy)
  0x04: 168, // Open (Legacy)
  0x05: 136, // Change (Legacy)
  0x06: 216  // State
};

function getSize(header) {
  switch(header.message_type) {
    case 0x02: { // KeepAlive
      return 144;
    }
    case 0x03: { // Publish
      const blockType = (header.extensions & 0x0f00) >> 8;
      const blockSize = blockSizes[blockType];

      if (blockSize) return blockSize;
      return 0;
    }
    case 0x04: { // Confirmation Request
      const blockCount = (header.extensions & 0xf000) >> 12;

      return blockCount * 64;
    }
    case 0x05: { // Confirmation Acknowledgement
      const blockCount = (header.extensions & 0xf000) >> 12;
      
      return 104 + (blockCount * 32);
    }
    case 0x0a: { // Node ID Handshake
      const queryLength = (header.extensions & 0x1) && 32;
      const responseLength = (header.extensions & 0x2) && 96;
      
      return queryLength + responseLength;
    }
    case 0x0c: { // Telemetry Request
      return 0;
    }
    case 0x0d: { // Telemetry Response
      const telemetryLength = (header.extensions & 0x3ff);

      return telemetryLength;
    }
  }
}

function streamPacketBody(packet) {
  const state = this.state;

  const bodyPtr = state.expectedBodySize - state.bodySize;
  const body = packet.subarray(
    0, bodyPtr
  );
  body.copy(state.body, 0, state.bodySize, state.expectedBodySize);
  state.bodySize += body.length;
  
  if (state.bodySize == state.expectedBodySize) {
    const msgInfo = Object.assign({}, state);
    delete msgInfo.bodySize;
    delete msgInfo.expectedBodySize;
    this.emit("message", msgInfo);

    this.state = Object.assign({}, defaultStreamState);

    const leftover = packet.subarray(bodyPtr);
    if (leftover.length > 0) {
      this.streamPacket(leftover)
    }
  }
}

function streamPacket(packet) {
  const state = this.state;
  
  if (state.headerLength == 8) {
      streamPacketBody(packet, state);
  } else {
    const headerPtr = 8 - state.headerLength;
    const header = packet.subarray(
      0, headerPtr
    );
    header.copy(state.header, 0, state.headerLength, 8);
    state.headerLength += header.length;

    if (state.headerLength >= 8) {
      if (state.header[0] !== 0x52) return true;
      if (state.header[1] !== 0x43) return true;
      if (state.header[2] < 0x12) return true;
      if (state.header[3] !== 0x12) return true;
      if (state.header[4] > 0x12) return true;
      state.version = state.header[3];
      state.message_type = state.header[5];
      state.extensions = (state.header[7] << 8)
        + state.header[6];
      const bodySize = getSize(state);
      
      state.body = Buffer.alloc(bodySize);
      state.expectedBodySize = bodySize;

      delete state.headerLength;
      delete state.header;
    }
    
    const leftover = packet.subarray(headerPtr);
    if (leftover.length > 0 || state.expectedBodySize == 0) {
      this.streamPacketBody(leftover);
    }
  }
}

class NanoStream {
  constructor() {
    this._ev = {
      "message": [],
      "error": []
    };

    this.state = Object.assign({}, defaultStreamState);
    this.isBusy = false;
    this.queue = [];
  }
  process(packet) {
    const result = this.streamPacket(packet);
    
    if (result) {
      this.emit("error");
    } else {
      const next = this.queue.shift();
      if (next) {
        this.process(next);
      } else {
        this.isBusy = false;
      }
    }
  }
  push(packet) {
    if (this.isBusy) {
      this.queue.push(packet);
    } else {
      this.isBusy = true;
      this.process(packet);
    }
  }
  emit(evName, ...args) {

    if (this._ev[evName] == undefined) {
      console.log("Emit",evName)
    }
    this._ev[evName].forEach(async(cb) => {
      cb(...args);
    })
  }
  on(evName, cb) {
    if (!this._ev[evName]) throw Error("Event Name '" + evName + "' doesn't exist.");
    this._ev[evName].push(cb);
  }
}

NanoStream.prototype.streamPacket = streamPacket;
NanoStream.prototype.streamPacketBody = streamPacketBody;

module.exports = NanoStream;
