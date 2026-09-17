import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderFrame,
  cleanMask,
  defaultEdit,
  resolutions,
  type Frame,
} from './editor.ts';
import { defaults } from './pipeline.ts';
import { encodeGif } from './gif.ts';
import { grayscalePng } from './grayscale-png.ts';
const w = 32,
  h = 28,
  rgba = new Uint8ClampedArray(w * h * 4),
  mask = new Float32Array(w * h);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const i = y * w + x;
    rgba.set([x * 8, y * 9, 120, 255], i * 4);
    if (x >= 10 && x < 22 && y >= 5 && y < 24) mask[i] = 1;
  }
const f: Frame = { rgba, mask, width: w, height: h };
test('Every resolution has exact dimensions and retains source data', () => {
  const before = rgba.slice();
  for (const r of resolutions) {
    const out = renderFrame(f, defaults, defaultEdit, r.w, r.h);
    assert.equal(out.length, r.w * r.h * 4);
    assert.equal(out[out.length - 1], 255);
  }
  assert.deepEqual(rgba, before);
});
test('Cutout stays flat with every dither and draws a dark exterior outline', () => {
  for (let dither = 0; dither < 3; dither++) {
    const out = renderFrame(
      f,
      { ...defaults, dither },
      { ...defaultEdit, cutout: true, cleanup: 0, outline: 1, background: 2 },
      w,
      h,
    );
    assert.deepEqual(Array.from(out.slice(0, 4)), [255, 80, 0, 255]);
    const i = (10 * w + 9) * 4;
    assert.deepEqual(Array.from(out.slice(i, i + 4)), [43, 30, 13, 255]);
  }
});
test('Mask cleanup removes detached noise without destroying a person', () => {
  const noisy = mask.slice();
  noisy[1] = 1;
  const clean = cleanMask(noisy, w, h, 50, 1);
  assert.equal(clean[1], 0);
  assert.equal(clean[10 * w + 15], 1);
});
test('Print rendering uses four neutral levels and white paper', () => {
  const out = renderFrame(
    f,
    defaults,
    { ...defaultEdit, cutout: true, background: 3, grayscale: true },
    w,
    h,
  );
  assert.deepEqual(Array.from(out.slice(0, 4)), [255, 255, 255, 255]);
  for (let i = 0; i < out.length; i += 4) {
    assert.equal(out[i], out[i + 1]);
    assert.equal(out[i], out[i + 2]);
    assert.ok([0, 85, 170, 255].includes(out[i]));
  }
});
test('Grayscale export declares actual grayscale PNG, with requested scale', async () => {
  const pixels = renderFrame(
    f,
    defaults,
    { ...defaultEdit, grayscale: true },
    w,
    h,
  );
  const bytes = new Uint8Array(
    await (await grayscalePng(pixels, w, h, 4)).arrayBuffer(),
  );
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(16), 128);
  assert.equal(view.getUint32(20), 112);
  assert.equal(bytes[25], 0);
});
test('GIF rejects mixed dimensions and has animation metadata', () => {
  const a = renderFrame(f, defaults, defaultEdit, w, h);
  const gif = encodeGif(Array(8).fill(a), w, h);
  assert.equal(new TextDecoder().decode(gif.slice(0, 6)), 'GIF89a');
  assert.ok(new TextDecoder().decode(gif).includes('NETSCAPE2.0'));
  assert.throws(() => encodeGif([a, new Uint8ClampedArray(4)], w, h));
});

test('2–4 tones constrain every palette, dither, background, outline and grayscale export', () => {
  for (const tones of [2, 3, 4])
    for (let palette = 0; palette < 5; palette++)
      for (let dither = 0; dither < 3; dither++)
        for (let background = 0; background < 4; background++)
          for (const grayscale of [false, true]) {
            const pixels = renderFrame(
              f,
              { ...defaults, tones, palette, dither },
              {
                ...defaultEdit,
                cutout: true,
                outline: 1,
                background,
                grayscale,
              },
              w,
              h,
            );
            const colors = new Set<string>();
            for (let i = 0; i < pixels.length; i += 4) {
              colors.add(Array.from(pixels.slice(i, i + 3)).join(','));
              if (grayscale) {
                assert.equal(pixels[i], pixels[i + 1]);
                assert.equal(pixels[i], pixels[i + 2]);
                assert.ok(
                  Array.from({ length: tones }, (_, j) =>
                    Math.round((j * 255) / (tones - 1)),
                  ).includes(pixels[i]),
                );
              }
            }
            assert.ok(
              colors.size <= tones,
              `${tones} tones produced ${colors.size} colors`,
            );
            assert.doesNotThrow(() => encodeGif([pixels, pixels], w, h));
          }
});

test('A full tonal ramp uses exactly the requested number of tones', () => {
  const ramp = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) ramp.set([i, i, i, 255], i * 4);
  for (const tones of [2, 3, 4]) {
    const pixels = renderFrame(
      { rgba: ramp, width: 256, height: 1 },
      { ...defaults, tones, dither: 0, contrast: 0 },
      defaultEdit,
      256,
      1,
    );
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4)
      colors.add(Array.from(pixels.slice(i, i + 3)).join(','));
    assert.equal(colors.size, tones);
  }
});
