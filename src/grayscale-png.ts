function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12),
    view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(name), 4);
  bytes.set(data, 8);
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, bytes.length - 4)));
  return bytes;
}
/** Opaque, true grayscale PNG (color type 0), with nearest-neighbor scaling. */
export async function grayscalePng(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  scale = 1,
) {
  if (pixels.length !== w * h * 4 || !Number.isInteger(scale) || scale < 1)
    throw Error('Invalid grayscale image');
  const width = w * scale,
    height = h * scale,
    raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4;
      if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2])
        throw Error('Image contains non-neutral colors');
      raw[y * (width + 1) + 1 + x] = pixels[i];
    }
  const header = new Uint8Array(13),
    v = new DataView(header.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  header[8] = 8;
  header[9] = 0;
  const stream = new Blob([raw])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return new Blob(
    [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', compressed),
      chunk('IEND', new Uint8Array()),
    ],
    { type: 'image/png' },
  );
}
