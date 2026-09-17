import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

export async function createPortraitSegmenter() {
  const files = await FilesetResolver.forVisionTasks(
    `${import.meta.env.BASE_URL}wasm`,
  );
  const model = await ImageSegmenter.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: `${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`,
      delegate: 'CPU',
    },
    runningMode: 'IMAGE',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  return {
    close: () => model.close(),
    mask: (input: HTMLCanvasElement) => {
      const W = input.width,
        H = input.height;
      let output: Float32Array | undefined;
      model.segment(input, (result) => {
        const masks = result.confidenceMasks;
        if (!masks?.length) throw Error('No portrait mask returned');
        const labels = model.getLabels();
        const person = labels.findIndex((l) => /person|selfie/i.test(l));
        // The bundled binary SelfieSegmenter exposes one foreground probability channel.
        const index = masks.length === 1 ? 0 : person >= 0 ? person : 1;
        const m = masks[index];
        if (!m) throw Error('Person mask is unavailable');
        const raw = m.getAsFloat32Array();
        output = new Float32Array(W * H);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++)
            output[y * W + x] =
              raw[
                Math.min(m.height - 1, Math.floor((y * m.height) / H)) *
                  m.width +
                  Math.min(m.width - 1, Math.floor((x * m.width) / W))
              ];
      });
      return output!;
    },
  };
}
