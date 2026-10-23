/**
 * Standalone offline ZIP generator providing standard JSZip API compatibility.
 * Allows pure client-side ZIP archive generation without external CDN dependencies.
 */
(function(global) {
  function crc32(buf) {
    let table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      table[i] = c;
    }
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  class LocalJSZip {
    constructor() {
      this.files = [];
    }

    file(path, content) {
      if (content === undefined || content === null) {
        // Find existing or return null
        return this.files.find(f => f.name === path) || null;
      }
      const encoder = new TextEncoder();
      let data;
      if (typeof content === 'string') {
        data = encoder.encode(content);
      } else if (content instanceof Uint8Array) {
        data = content;
      } else if (content instanceof ArrayBuffer) {
        data = new Uint8Array(content);
      } else {
        data = encoder.encode(String(content));
      }
      // Normalize slashes
      const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
      this.files.push({ name: cleanPath, data });
      return this;
    }

    async generateAsync(options = {}) {
      const encoder = new TextEncoder();
      const parts = [];
      const central = [];
      let offset = 0;

      const now = new Date();
      const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
      const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

      for (const f of this.files) {
        const nameBytes = encoder.encode(f.name);
        const crc = crc32(f.data);
        const size = f.data.length;

        // Local file header (30 bytes + name length)
        const lfh = new Uint8Array(30 + nameBytes.length);
        const dv = new DataView(lfh.buffer);
        dv.setUint32(0, 0x04034b50, true); // Local header signature
        dv.setUint16(4, 20, true);         // Version needed
        dv.setUint16(6, 0x0800, true);     // UTF-8 filename flag
        dv.setUint16(8, 0, true);          // Store (uncompressed)
        dv.setUint16(10, time, true);
        dv.setUint16(12, date, true);
        dv.setUint32(14, crc, true);
        dv.setUint32(18, size, true);      // Compressed size
        dv.setUint32(22, size, true);      // Uncompressed size
        dv.setUint16(26, nameBytes.length, true);
        dv.setUint16(28, 0, true);         // Extra field length
        lfh.set(nameBytes, 30);

        parts.push(lfh);
        parts.push(f.data);

        // Central directory header (46 bytes + name length)
        const cdh = new Uint8Array(46 + nameBytes.length);
        const cdv = new DataView(cdh.buffer);
        cdv.setUint32(0, 0x02014b50, true); // Central directory signature
        cdv.setUint16(4, 20, true);         // Version made by
        cdv.setUint16(6, 20, true);         // Version needed
        cdv.setUint16(8, 0x0800, true);     // UTF-8
        cdv.setUint16(10, 0, true);         // Store
        cdv.setUint16(12, time, true);
        cdv.setUint16(14, date, true);
        cdv.setUint32(16, crc, true);
        cdv.setUint32(20, size, true);
        cdv.setUint32(24, size, true);
        cdv.setUint16(28, nameBytes.length, true);
        cdv.setUint16(30, 0, true);         // Extra field length
        cdv.setUint16(32, 0, true);         // Comment length
        cdv.setUint16(34, 0, true);         // Disk start
        cdv.setUint16(36, 0, true);         // Internal attr
        cdv.setUint32(38, 0, true);         // External attr
        cdv.setUint32(42, offset, true);    // Offset of local header
        cdh.set(nameBytes, 46);

        central.push(cdh);
        offset += lfh.length + size;
      }

      const centralOffset = offset;
      let centralSize = 0;
      for (const c of central) centralSize += c.length;

      // End of central directory record (22 bytes)
      const eocd = new Uint8Array(22);
      const edv = new DataView(eocd.buffer);
      edv.setUint32(0, 0x06054b50, true);
      edv.setUint16(4, 0, true);
      edv.setUint16(6, 0, true);
      edv.setUint16(8, this.files.length, true);
      edv.setUint16(10, this.files.length, true);
      edv.setUint32(12, centralSize, true);
      edv.setUint32(16, centralOffset, true);
      edv.setUint16(20, 0, true);

      const totalLen = offset + centralSize + 22;
      const finalBuf = new Uint8Array(totalLen);
      let cur = 0;
      for (const p of parts) {
        finalBuf.set(p, cur);
        cur += p.length;
      }
      for (const c of central) {
        finalBuf.set(c, cur);
        cur += c.length;
      }
      finalBuf.set(eocd, cur);

      if (options.type === 'blob' || !options.type) {
        return new Blob([finalBuf], { type: 'application/zip' });
      }
      if (options.type === 'uint8array') {
        return finalBuf;
      }
      if (options.type === 'arraybuffer') {
        return finalBuf.buffer;
      }
      return new Blob([finalBuf], { type: 'application/zip' });
    }
  }

  // Always make JSZip available globally if not already loaded from CDN
  if (typeof global.JSZip === 'undefined') {
    global.JSZip = LocalJSZip;
  }
})(typeof window !== 'undefined' ? window : globalThis);
