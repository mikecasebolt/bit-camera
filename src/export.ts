export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function pixelCanvas(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  scale = 1,
) {
  const raw = document.createElement('canvas');
  raw.width = w;
  raw.height = h;
  raw
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
  if (scale === 1) return raw;
  const out = document.createElement('canvas');
  out.width = w * scale;
  out.height = h * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(raw, 0, 0, out.width, out.height);
  return out;
}
export async function png(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error('PNG export failed'))),
      'image/png',
    ),
  );
}
export async function webm(
  frames: Uint8ClampedArray[],
  w: number,
  h: number,
  delay: number,
) {
  const mime = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find(
    (t) =>
      typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
  );
  if (!mime) throw Error('WebM export is unavailable. Use GIF instead.');
  const c = pixelCanvas(frames[0], w, h, 4),
    ctx = c.getContext('2d')!,
    stream = c.captureStream(0),
    track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 8000000,
    }),
    chunks: Blob[] = [];
  return new Promise<Blob>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>,
      watchdog: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(watchdog);
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => {
      cleanup();
      reject(Error('Video export failed. Try GIF.'));
    };
    recorder.onstop = () => {
      cleanup();
      const b = new Blob(chunks, { type: mime });
      b.size ? resolve(b) : reject(Error('Video was empty. Try GIF.'));
    };
    let i = 0;
    const tick = () => {
      if (i >= frames.length) {
        recorder.stop();
        return;
      }
      const frame = pixelCanvas(frames[i++], w, h);
      ctx.drawImage(frame, 0, 0, c.width, c.height);
      track.requestFrame();
      timer = setTimeout(tick, delay);
    };
    recorder.onstart = tick;
    watchdog = setTimeout(
      () => {
        if (recorder.state !== 'inactive') recorder.stop();
      },
      frames.length * delay + 5000,
    );
    try {
      recorder.start();
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}
