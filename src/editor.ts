import {
  processPixels,
  palettes,
  toneIndices,
  backgroundIndex,
  type Settings,
} from './pipeline.ts';
export const resolutions = [
  { w: 64, h: 56 },
  { w: 128, h: 112 },
  { w: 256, h: 224 },
  { w: 512, h: 448 },
];
export type Frame = {
  rgba: Uint8ClampedArray;
  mask?: Float32Array;
  width: number;
  height: number;
};
export type Edit = {
  cutout: boolean;
  threshold: number;
  cleanup: number;
  outline: number;
  background: number;
  grayscale: boolean;
};
export const defaultEdit: Edit = {
  cutout: false,
  threshold: 50,
  cleanup: 1,
  outline: 0,
  background: 3,
  grayscale: false,
};
export function resizeFrame(f: Frame, w: number, h: number): Frame {
  if (f.width === w && f.height === h) return f;
  const rgba = new Uint8ClampedArray(w * h * 4),
    mask = f.mask ? new Float32Array(w * h) : undefined;
  // Area averaging preserves detail when reducing a high-resolution capture.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0,
        m = 0;
      const channels = [0, 0, 0];
      const y0 = Math.floor((y * f.height) / h),
        y1 = Math.max(y0 + 1, Math.floor(((y + 1) * f.height) / h)),
        x0 = Math.floor((x * f.width) / w),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * f.width) / w));
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const j = sy * f.width + sx;
          n++;
          for (let c = 0; c < 3; c++) channels[c] += f.rgba[j * 4 + c];
          m += f.mask?.[j] ?? 0;
        }
      const i = y * w + x;
      rgba.set([...channels.map((c) => c / n), 255], i * 4);
      if (mask) mask[i] = m / n;
    }
  return { rgba, mask, width: w, height: h };
}
export function cleanMask(
  mask: Float32Array,
  w: number,
  h: number,
  threshold: number,
  passes: number,
) {
  let bits = Uint8Array.from(mask, (v) => (v >= threshold / 100 ? 1 : 0));
  for (let pass = 0; pass < passes; pass++) {
    const next = bits.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let votes = 0,
          total = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx >= 0 && xx < w && yy >= 0 && yy < h) {
              votes += bits[yy * w + xx];
              total++;
            }
          }
        next[y * w + x] = votes > total / 2 ? 1 : 0;
      }
    bits = next;
  }
  // Drop tiny detached foreground islands; preserve multiple substantial people.
  if (passes) {
    const seen = new Uint8Array(w * h),
      components: number[][] = [];
    let largest = 0;
    for (let i = 0; i < bits.length; i++) {
      if (!bits[i] || seen[i]) continue;
      const q = [i];
      seen[i] = 1;
      for (let k = 0; k < q.length; k++) {
        const j = q[k],
          x = j % w,
          y = Math.floor(j / w);
        for (const n of [
          x > 0 ? j - 1 : -1,
          x + 1 < w ? j + 1 : -1,
          y > 0 ? j - w : -1,
          y + 1 < h ? j + w : -1,
        ])
          if (n >= 0 && bits[n] && !seen[n]) {
            seen[n] = 1;
            q.push(n);
          }
      }
      components.push(q);
      largest = Math.max(largest, q.length);
    }
    for (const c of components)
      if (c.length < Math.max(3, largest * 0.02))
        for (const i of c) bits[i] = 0;
  }
  return bits;
}
export function renderFrame(
  f: Frame,
  s: Settings,
  e: Edit,
  w: number,
  h: number,
) {
  const resized = resizeFrame(f, w, h);
  const pixels = processPixels(resized.rgba, s, resized.mask, w, h);
  const colors = palettes[s.palette].colors.map((c) =>
    [1, 3, 5].map((j) => parseInt(c.slice(j, j + 2), 16)),
  );
  if (e.cutout && resized.mask) {
    const bits = cleanMask(resized.mask, w, h, e.threshold, e.cleanup);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (bits[i]) continue;
        let edge = false;
        if (e.outline)
          for (let dy = -e.outline; dy <= e.outline && !edge; dy++)
            for (let dx = -e.outline; dx <= e.outline; dx++) {
              const xx = x + dx,
                yy = y + dy;
              if (
                dx * dx + dy * dy <= e.outline * e.outline &&
                xx >= 0 &&
                xx < w &&
                yy >= 0 &&
                yy < h &&
                bits[yy * w + xx]
              ) {
                edge = true;
                break;
              }
            }
        pixels.set(
          [...colors[edge ? 0 : backgroundIndex(e.background, s.tones)], 255],
          i * 4,
        );
      }
  }
  if (e.grayscale)
    for (let i = 0; i < pixels.length; i += 4) {
      const index = colors.findIndex(
        (c) =>
          c[0] === pixels[i] &&
          c[1] === pixels[i + 1] &&
          c[2] === pixels[i + 2],
      );
      const value = Math.round(
        (Math.max(0, toneIndices(s.tones).indexOf(index)) * 255) /
          (s.tones - 1),
      );
      pixels.set([value, value, value, 255], i);
    }
  return pixels;
}
