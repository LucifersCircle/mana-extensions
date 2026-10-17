// Test-only complete-container checks paired with actual browser image.decode().
// This is not a standalone pixel decoder and never changes the server MIME.
import assert from 'node:assert/strict';
export function verifyRasterImageBytes(input) {
  const bytes = Buffer.from(input);
  assert(bytes.length > 0 && bytes.length <= 16 * 1024 * 1024, 'Invalid image body size');
  const result = (width, height, format) => {
    assert([width, height].every(value => Number.isSafeInteger(value) && value > 0), 'Invalid image dimensions');
    return { width, height, format };
  };
  // Walk complete container boundaries; the browser supplies pixel decoding.
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    assert(bytes.length >= 45, 'Truncated PNG');
    assert.equal(bytes.readUInt32BE(8), 13, 'Invalid PNG IHDR length');
    assert.equal(bytes.subarray(12, 16).toString(), 'IHDR', 'PNG has no initial IHDR');
    const dimensions = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    let imageData = false;
    for (let offset = 8; offset < bytes.length;) {
      assert(offset + 12 <= bytes.length, 'Truncated PNG chunk');
      const size = bytes.readUInt32BE(offset), kind = bytes.subarray(offset + 4, offset + 8).toString();
      assert(size <= bytes.length - offset - 12, 'Truncated PNG chunk data');
      assert(offset === 8 || kind !== 'IHDR', 'Duplicate PNG IHDR');
      if (kind === 'IDAT' && size > 0) imageData = true;
      offset += size + 12;
      if (kind === 'IEND') {
        assert(size === 0 && imageData && offset === bytes.length, 'PNG has no image data or is incomplete');
        return result(...dimensions, 'PNG');
      }
    }
    assert.fail('PNG has no IEND');
  }
  if (bytes.length >= 30 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'WebP is incomplete');
    let dimensions, hasFrame = false;
    for (let offset = 12; offset < bytes.length;) {
      assert(offset + 8 <= bytes.length, 'Truncated WebP chunk');
      const kind = bytes.subarray(offset, offset + 4).toString(), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
      assert(size + (size % 2) <= bytes.length - start, 'Malformed WebP chunk length');
      if (kind === 'VP8X') {
        assert(size >= 10 && !dimensions, 'Invalid WebP extended dimensions');
        dimensions = [bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1];
      } else if (kind === 'VP8 ') {
        assert(size >= 10 && bytes.subarray(start + 3, start + 6).toString('hex') === '9d012a', 'Invalid WebP frame');
        dimensions ??= [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff]; hasFrame = true;
      } else if (kind === 'VP8L') {
        assert(size >= 5 && bytes[start] === 0x2f, 'Invalid lossless WebP frame');
        const packed = bytes.readUInt32LE(start + 1);
        dimensions ??= [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1]; hasFrame = true;
      }
      offset = start + size + (size % 2);
    }
    assert(hasFrame && dimensions, 'WebP has no supported image frame');
    return result(...dimensions, 'WEBP');
  }
  assert(bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8 && bytes.readUInt16BE(bytes.length - 2) === 0xffd9, 'Cover is not complete JPEG bytes');
  // Bound the SOF scan and validate segment lengths, not filename/HTML dimensions.
  let offset = 2;
  for (let count = 0; count < 1024 && offset + 3 < bytes.length; count += 1) {
    assert.equal(bytes[offset++], 0xff, 'Malformed JPEG marker');
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    assert(marker !== 0xda && marker !== 0xd9, 'JPEG has no SOF dimensions');
    const size = bytes.readUInt16BE(offset);
    assert(size >= 2 && offset + size <= bytes.length, 'Malformed JPEG segment length');
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      assert(size >= 8, 'Truncated JPEG SOF');
      return result(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3), 'JPEG');
    }
    offset += size;
  }
  assert.fail('JPEG SOF dimensions missing or beyond the bounded scan');
}
