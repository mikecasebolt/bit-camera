// A four-color GIF89a encoder. Frequent clear codes keep LZW code width
// fixed at three bits; files are larger, but lossless and dependency-free.
export function encodeGif(
  frames: Uint8ClampedArray[],
  w: number,
  h: number,
  delay = 250,
) {
  if (!frames.length) throw Error('No frames to export');
  const colors: number[][] = [],
    indices: Uint8Array[] = [];
  for (const frame of frames) {
    if (frame.length !== w * h * 4)
      throw Error('Frame dimensions do not match');
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const c = Array.from(frame.slice(i * 4, i * 4 + 3));
      let j = colors.findIndex((v) => v.every((n, k) => n === c[k]));
      if (j < 0) {
        j = colors.length;
        if (j >= 4) throw Error('GIF requires one shared four-color palette');
        colors.push(c);
      }
      idx[i] = j;
    }
    indices.push(idx);
  }
  while (colors.length < 4) colors.push([0, 0, 0]);
  const out: number[] = [];
  const str = (s: string) => {
    for (const c of s) out.push(c.charCodeAt(0));
  };
  const word = (v: number) => out.push(v & 255, (v >> 8) & 255);
  str('GIF89a');
  word(w);
  word(h);
  out.push(0x91, 0, 0);
  colors.forEach((c) => out.push(...c));
  out.push(0x21, 0xff, 11);
  str('NETSCAPE2.0');
  out.push(3, 1, 0, 0, 0);
  for (const idx of indices) {
    out.push(0x21, 0xf9, 4, 4);
    word(Math.round(delay / 10));
    out.push(0, 0, 0x2c);
    word(0);
    word(0);
    word(w);
    word(h);
    out.push(0, 2);
    const bytes: number[] = [];
    let bits = 0,
      used = 0;
    const code = (n: number) => {
      bits |= n << used;
      used += 3;
      while (used >= 8) {
        bytes.push(bits & 255);
        bits >>>= 8;
        used -= 8;
      }
    };
    for (const i of idx) {
      code(4);
      code(i);
    }
    code(5);
    if (used) bytes.push(bits & 255);
    for (let i = 0; i < bytes.length; i += 255) {
      const block = bytes.slice(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}
