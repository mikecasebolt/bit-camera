export const W = 128,
  H = 112;
export const palettes = [
  { name: 'APRICOT', colors: ['#2b1e0d', '#92502b', '#ff5000', '#d8ccaa'] },
  { name: 'CLASSIC', colors: ['#16352b', '#416b3f', '#97ad57', '#dceba4'] },
  { name: 'MONO', colors: ['#202020', '#686868', '#b0b0b0', '#f4f4ed'] },
  { name: 'TIDAL', colors: ['#111d3b', '#285a85', '#64b4bb', '#d0f5e7'] },
  { name: 'CHERRY', colors: ['#3a122c', '#922b4e', '#dc7a90', '#ffe4db'] },
];
export type Settings = {
  bg: number;
  exposure: number;
  contrast: number;
  dither: number;
  palette: number;
  tones: number;
};
export const defaults: Settings = {
  bg: 0,
  exposure: 0,
  contrast: 1,
  dither: 1,
  palette: 0,
  tones: 4,
};
export function toneIndices(tones: number) {
  return tones === 2 ? [0, 3] : tones === 3 ? [0, 2, 3] : [0, 1, 2, 3];
}
export function backgroundIndex(index: number, tones: number) {
  return toneIndices(tones).reduce((best, i) =>
    Math.abs(i - index) < Math.abs(best - index) ? i : best,
  );
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function backgroundTone(
  raw: number,
  coarse: number,
  person: number,
  step: number,
) {
  const amount = step / 6;
  const simplified = coarse * (1 - amount) + 0.93 * amount;
  return raw + (simplified - raw) * (1 - clamp((person - 0.2) / 0.6)) * amount;
}
export function processPixels(
  rgba: Uint8ClampedArray,
  s: Settings,
  mask?: Float32Array,
  W = 128,
  H = 112,
) {
  const count = W * H,
    gray = new Float32Array(count),
    toned = new Float32Array(count);
  for (let i = 0; i < count; i++)
    gray[i] =
      (0.2126 * rgba[i * 4] +
        0.7152 * rgba[i * 4 + 1] +
        0.0722 * rgba[i * 4 + 2]) /
      255;
  const coarse = new Float32Array(count);
  for (let y = 0; y < H; y += 8)
    for (let x = 0; x < W; x += 8) {
      let sum = 0,
        n = 0;
      for (let dy = 0; dy < 8 && y + dy < H; dy++)
        for (let dx = 0; dx < 8 && x + dx < W; dx++) {
          sum += gray[(y + dy) * W + x + dx];
          n++;
        }
      for (let dy = 0; dy < 8 && y + dy < H; dy++)
        for (let dx = 0; dx < 8 && x + dx < W; dx++)
          coarse[(y + dy) * W + x + dx] = sum / n;
    }
  for (let i = 0; i < count; i++) {
    const v =
      mask && s.bg
        ? backgroundTone(gray[i], coarse[i], mask[i], s.bg)
        : gray[i];
    toned[i] = clamp(
      (v * Math.pow(2, s.exposure / 3) - 0.5) * (1 + s.contrast * 0.2) + 0.5,
    );
  }
  const levels = s.tones - 1;
  const colors = toneIndices(s.tones)
    .map((i) => palettes[s.palette].colors[i])
    .map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const out = new Uint8ClampedArray(count * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const flat = s.bg === 6 && mask !== undefined && mask[i] <= 0.2;
      const v = clamp(
        (flat
          ? clamp(
              (0.93 * Math.pow(2, s.exposure / 3) - 0.5) *
                (1 + s.contrast * 0.2) +
                0.5,
            )
          : toned[i]) +
          (s.dither === 1 && !flat
            ? (bayer[(y % 4) * 4 + (x % 4)] / 16 - 0.46875) / levels
            : 0),
      );
      const q = Math.round(v * levels),
        c = colors[q];
      out.set([...c, 255], i * 4);
      if (s.dither === 2 && !flat) {
        const e = v - q / levels;
        if (x + 1 < W) toned[i + 1] += (e * 7) / 16;
        if (y + 1 < H) {
          if (x > 0) toned[i + W - 1] += (e * 3) / 16;
          toned[i + W] += (e * 5) / 16;
          if (x + 1 < W) toned[i + W + 1] += e / 16;
        }
      }
    }
  return out;
}
