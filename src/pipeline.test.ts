import test from 'node:test';
import assert from 'node:assert/strict';
import {
  W,
  H,
  defaults,
  palettes,
  processPixels,
  backgroundTone,
} from './pipeline.ts';
const input = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  input.set([i % 256, (i * 7) % 256, (i * 13) % 256, 255], i * 4);
}
test('Every dither and palette produces only the chosen four opaque colors', () => {
  for (let p = 0; p < palettes.length; p++)
    for (let d = 0; d < 3; d++) {
      const out = processPixels(input, { ...defaults, palette: p, dither: d });
      const colors = new Set(palettes[p].colors.map((c) => c.toLowerCase()));
      for (let i = 0; i < out.length; i += 4) {
        assert.equal(out[i + 3], 255);
        assert.ok(
          colors.has(
            '#' +
              [out[i], out[i + 1], out[i + 2]]
                .map((n) => n.toString(16).padStart(2, '0'))
                .join(''),
          ),
        );
      }
    }
});
test('RAW is unchanged, CLEAN reduces detail, CUTOUT is flat, foreground survives', () => {
  assert.equal(backgroundTone(0.2, 0.5, 0, 0), 0.2);
  assert.ok(backgroundTone(0.2, 0.5, 0, 3) > 0.2);
  assert.ok(Math.abs(backgroundTone(0.2, 0.5, 0, 6) - 0.93) < 1e-7);
  assert.ok(Math.abs(backgroundTone(0.8, 0.1, 0, 6) - 0.93) < 1e-7);
  for (let s = 0; s < 7; s++) assert.equal(backgroundTone(0.2, 0.5, 1, s), 0.2);
});
test('Absent segmentation safely leaves RAW output and all-foreground mask preserves image', () => {
  const raw = processPixels(input, defaults);
  assert.deepEqual(processPixels(input, { ...defaults, bg: 6 }), raw);
  assert.deepEqual(
    processPixels(
      input,
      { ...defaults, bg: 6 },
      new Float32Array(W * H).fill(1),
    ),
    raw,
  );
});
test('No-person CUTOUT yields a uniform background', () => {
  for (let dither = 0; dither < 3; dither++) {
    const out = processPixels(
      input,
      { ...defaults, bg: 6, dither },
      new Float32Array(W * H),
    );
    for (let i = 4; i < out.length; i += 4)
      assert.deepEqual(out.slice(i, i + 4), out.slice(0, 4));
  }
});
test('Exposure, contrast, and dithering each change the image', () => {
  for (const change of [
    { exposure: 3 },
    { contrast: 4 },
    { dither: 0 },
    { dither: 2 },
  ])
    assert.notDeepEqual(
      processPixels(input, { ...defaults, ...change }),
      processPixels(input, defaults),
    );
});
