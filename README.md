# Bit Camera

Desktop Chrome webcam and image-upload camera. React + Vite + TypeScript; all image processing stays in the browser.

## Run

Requires Node 22.13+.

```
npm install
npm run dev
```

Open the printed localhost URL in Chrome. Click START CAMERA and allow camera permission, or LOAD PHOTO. Camera access needs localhost or HTTPS, not a remote HTTP LAN address.

## Camera and editor

- Resolution: 64 × 56, 128 × 112, 256 × 224, or 512 × 448. Photo sources are retained at 512 × 448 so changing pixel resolution is reversible.
- COLOR TONES: select 2, 3, or 4 before or after capture. Two uses dark/light; three adds the accent tone; four uses the whole palette. Backgrounds, outlines and exports respect this limit.
- BG / CNT / EXP / DTH / PAL adjust background noise, contrast, exposure, dithering and palette before or after capture.
- PHOTO, 6 FRAMES, or 8 FRAMES. Loops capture at a target 4 frames/sec and play at 4 frames/sec, for 1.5 or 2 seconds. Keep the tab visible during capture. B cancels an unfinished loop.
- A or Space captures. B or Escape returns from review. In loop review, Space toggles playback; numbered buttons select individual frames.
- Post-capture FLAT CUTOUT removes background texture. Pick any palette tone as the background, add a 1–3 pixel darkest-tone outline, and tune mask cleanup and edge trim.
- REFERENCE LOOK selects the orange/cream/dark-brown palette inspired by IMG_6402.jpg, three solid tones, a flat orange background and a 1-pixel outline. It does not convert a photo into drawn anime artwork.
- Edits apply to all frames in a loop. Original capture data is retained until retake or another source replaces it.

## Export

- PNG: native pixel dimensions or crisp 4× enlargement. Loop review can export its selected frame.
- SAVE GRAYSCALE PNG: actual single-channel PNG (color type 0), with the selected neutral levels (2: 0/255; 3: 0/128/255; 4: 0/85/170/255) and no alpha. Select the lightest background swatch with FLAT CUTOUT for white paper. Set physical print size and printer-specific screening in print software; no ink separations or automatic risograph calibration are performed.
- GIF: exact 6 or 8 frames, lossless selected 2–4-color palette, 250 ms per frame and infinite looping.
- WEBM: silent video made from the edited frames, enlarged 4×. Browser video encoding may slightly alter palette colors; GIF preserves them exactly. Keep the tab visible during video export.

## Validation

```
npm test
npm run build
npm start
```

Thirteen automated tests cover four-color output, every resolution, source preservation, flat backgrounds, mask cleanup, outline placement, neutral grayscale values, grayscale PNG headers and GIF validation. Independent Pillow decoding also verifies every pixel of both six- and eight-frame GIFs, their frame delays and loop metadata, and grayscale PNG mode/dimensions/scaling.

Live Chrome webcam interactions and MediaRecorder WebM playback still require manual verification; computer access is unavailable in this session. Segmentation accuracy depends on lighting and silhouette. Inference is synchronous and throttled, so slower laptops may have reduced preview speed. The mobile-friendly layout does not imply mobile-camera verification.

## Implementation

- `src/pipeline.ts`: resolution-aware tone mapping and dithering.
- `src/segmentation.ts`: local MediaPipe SelfieSegmenter; foreground probabilities in the same crop as the source image.
- `src/editor.ts`: area sampling, mask threshold/majority cleanup, small-island removal, exterior silhouette outlines and print tones.
- `src/gif.ts`: four-color GIF89a encoding.
- `src/grayscale-png.ts`: grayscale PNG encoding with browser-native Deflate.
- `src/export.ts`: browser PNG/download and silent WebM export.

Fonts load from Google Fonts, with a monospace fallback. Model and WASM assets are bundled locally. No photos are uploaded and no paid API is required.

Model: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
Documentation: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter

## GitHub Pages

The public test site is https://mikecasebolt.github.io/bit-camera/ . Pushes to `main` run tests, build, and deploy automatically through GitHub Actions. In repository Settings → Pages, the deployment source is GitHub Actions.

For a local Pages-style build, run `PAGES_BASE_PATH=/bit-camera/ npm run build`. The default build still serves from `/`. Model and WASM paths follow the configured base path.
