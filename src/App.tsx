import { useEffect, useMemo, useRef, useState } from 'react';
import {
  palettes,
  defaults,
  toneIndices,
  backgroundIndex,
  type Settings,
} from './pipeline';
import {
  resolutions,
  defaultEdit,
  renderFrame,
  type Frame,
  type Edit,
} from './editor';
import { encodeGif } from './gif';
import { grayscalePng } from './grayscale-png';
import { pixelCanvas, png, download, webm } from './export';
const names = ['BG', 'CNT', 'EXP', 'DTH', 'PAL'] as const;
const DELAY = 250,
  RAW_W = 512,
  RAW_H = 448;
type Portrait = Awaited<
  ReturnType<typeof import('./segmentation').createPortraitSegmenter>
>;
export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null),
    video = useRef<HTMLVideoElement>(null),
    file = useRef<HTMLInputElement>(null),
    stream = useRef<MediaStream | null>(null),
    still = useRef<HTMLImageElement | null>(null),
    segmenter = useRef<Portrait | null>(null),
    lastFrame = useRef<Frame | null>(null),
    recording = useRef<{
      frames: Frame[];
      next: number;
      target: number;
    } | null>(null),
    generation = useRef(0);
  const [source, setSource] = useState<'off' | 'camera' | 'image'>('off'),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState<Settings>({ ...defaults }),
    [tab, setTab] = useState<(typeof names)[number]>('BG'),
    [message, setMessage] = useState(''),
    [modelStatus, setModelStatus] = useState('idle'),
    [resolution, setResolution] = useState(1),
    [mode, setMode] = useState(1),
    [progress, setProgress] = useState(0),
    [frames, setFrames] = useState<Frame[]>([]),
    [edit, setEdit] = useState<Edit>({ ...defaultEdit }),
    [frameIndex, setFrameIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [exporting, setExporting] = useState(false),
    [ready, setReady] = useState(false),
    [revision, setRevision] = useState(0),
    [shot, setShot] = useState(0);
  const review = frames.length > 0,
    { w, h } = resolutions[resolution],
    locked = progress > 0 || exporting;
  const stop = () => {
    generation.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recording.current = null;
    setProgress(0);
    lastFrame.current = null;
    setReady(false);
  };
  useEffect(
    () => () => {
      generation.current++;
      stream.current?.getTracks().forEach((t) => t.stop());
      recording.current = null;
    },
    [],
  );
  useEffect(() => {
    if (source === 'off') return;
    let cancelled = false;
    setModelStatus('loading');
    import('./segmentation')
      .then((m) => m.createPortraitSegmenter())
      .then((m) => {
        if (cancelled) m.close();
        else {
          segmenter.current = m;
          setModelStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setModelStatus('error');
      });
    return () => {
      cancelled = true;
      segmenter.current?.close();
      segmenter.current = null;
    };
  }, [source === 'off']);
  function resetReview() {
    setFrames([]);
    setFrameIndex(0);
    setPlaying(false);
    setEdit({ ...defaultEdit });
  }
  async function start() {
    if (busy) return;
    stop();
    const id = generation.current;
    setBusy(true);
    setMessage('');
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error(
          'Open this app in Chrome on HTTPS or localhost to use the webcam.',
        );
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (id !== generation.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      video.current!.srcObject = s;
      await video.current!.play();
      if (id !== generation.current) return;
      still.current = null;
      resetReview();
      setSource('camera');
      setRevision((n) => n + 1);
      s.getVideoTracks()[0].onended = () => {
        stop();
        setSource('off');
        setMessage('Camera disconnected. Reconnect it or load a photo.');
      };
    } catch (e) {
      if (id === generation.current) {
        stop();
        setSource('off');
        setMessage(
          e instanceof Error ? e.message : 'Could not start the camera.',
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function upload(f?: File) {
    if (!f) return;
    stop();
    const id = generation.current,
      url = URL.createObjectURL(f),
      img = new Image();
    setBusy(true);
    try {
      img.src = url;
      await img.decode();
      if (id !== generation.current) return;
      still.current = img;
      setSource('image');
      setMode(1);
      resetReview();
      setRevision((n) => n + 1);
      setMessage('');
    } catch {
      setMessage('That photo could not be opened. Try a JPG or PNG.');
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }
  useEffect(() => {
    if (source === 'off' || review) return;
    let raf = 0,
      last = 0,
      lastMask = 0,
      mask: Float32Array | undefined,
      failed = false;
    const input = document.createElement('canvas');
    input.width = RAW_W;
    input.height = RAW_H;
    const ctx = input.getContext('2d', { willReadFrequently: true })!;
    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) {
        if (recording.current) {
          recording.current = null;
          setProgress(0);
          setMessage(
            'Loop cancelled when the tab was hidden. Keep it visible while recording.',
          );
        }
        return;
      }
      if (time - last < 100) return;
      last = time;
      const img = source === 'camera' ? video.current : still.current;
      if (!img) return;
      const iw =
          img instanceof HTMLVideoElement ? img.videoWidth : img.naturalWidth,
        ih =
          img instanceof HTMLVideoElement ? img.videoHeight : img.naturalHeight;
      if (!iw || !ih) return;
      const scale = Math.max(RAW_W / iw, RAW_H / ih);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, RAW_W, RAW_H);
      ctx.save();
      if (source === 'camera') {
        ctx.translate(RAW_W, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(
        img,
        (RAW_W - iw * scale) / 2,
        (RAW_H - ih * scale) / 2,
        iw * scale,
        ih * scale,
      );
      ctx.restore();
      const rec = recording.current,
        due = rec && time >= rec.next;
      if (
        segmenter.current &&
        !failed &&
        (due || time - lastMask > 250 || !mask)
      ) {
        try {
          mask = segmenter.current.mask(input);
          lastMask = time;
        } catch {
          failed = true;
          mask = undefined;
          setModelStatus('error');
        }
      }
      const frame: Frame = {
        rgba: ctx.getImageData(0, 0, RAW_W, RAW_H).data,
        mask,
        width: RAW_W,
        height: RAW_H,
      };
      lastFrame.current = frame;
      setReady(true);
      const pixels = renderFrame(frame, settings, defaultEdit, w, h);
      canvas.current
        ?.getContext('2d')
        ?.putImageData(new ImageData(pixels, w, h), 0, 0);
      if (rec && due) {
        rec.frames.push(frame);
        rec.next = rec.next === 0 ? time + DELAY : rec.next + DELAY;
        setProgress(rec.frames.length);
        if (rec.frames.length === rec.target) {
          recording.current = null;
          setProgress(0);
          setFrames(rec.frames);
          setEdit({ ...defaultEdit });
          setFrameIndex(0);
          setPlaying(false);
          setShot((n) => n + 1);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [source, review, settings, w, h, modelStatus, revision]);
  // If a shutter preceded model loading, resolve masks from the retained source,
  // not a later webcam frame or the already-quantized preview.
  useEffect(() => {
    if (
      !review ||
      modelStatus !== 'ready' ||
      !segmenter.current ||
      frames.every((f) => f.mask)
    )
      return;
    try {
      setFrames(
        frames.map((f) =>
          f.mask
            ? f
            : {
                ...f,
                mask: segmenter.current!.mask(
                  pixelCanvas(f.rgba, f.width, f.height),
                ),
              },
        ),
      );
    } catch {
      setModelStatus('error');
    }
  }, [frames, modelStatus, review]);
  const rendered = useMemo(
    () => frames.map((f) => renderFrame(f, settings, edit, w, h)),
    [frames, settings, edit, w, h],
  );
  useEffect(() => {
    if (!review || !rendered.length) return;
    canvas.current
      ?.getContext('2d')
      ?.putImageData(
        new ImageData(
          rendered[Math.min(frameIndex, rendered.length - 1)],
          w,
          h,
        ),
        0,
        0,
      );
  }, [rendered, review, frameIndex, w, h]);
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = setInterval(
      () => setFrameIndex((n) => (n + 1) % frames.length),
      DELAY,
    );
    return () => clearInterval(timer);
  }, [playing, frames.length]);
  function capture() {
    if (!ready || review || locked || !lastFrame.current) return;
    setMessage('');
    if (mode > 1) {
      if (source !== 'camera') {
        setMessage('Use the webcam to record a loop.');
        return;
      }
      recording.current = { frames: [], next: 0, target: mode };
      setProgress(1);
    } else {
      setFrames([{ ...lastFrame.current, mask: undefined }]);
      setEdit({ ...defaultEdit });
      setFrameIndex(0);
      setShot((n) => n + 1);
    }
  }
  function back() {
    if (exporting) return;
    if (recording.current) {
      recording.current = null;
      setProgress(0);
      return;
    }
    resetReview();
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('button,input,select,textarea'))
        return;
      if (e.code === 'Space' || e.key.toLowerCase() === 'a') {
        e.preventDefault();
        if (review && frames.length > 1) setPlaying((v) => !v);
        else capture();
      }
      if (e.key === 'Escape' || e.key.toLowerCase() === 'b') back();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ready, review, locked, mode, source, frames.length, exporting]);
  async function save(kind: 'png' | 'gray' | 'gif' | 'webm', scale = 1) {
    if (exporting) return;
    setExporting(true);
    setPlaying(false);
    setMessage('');
    try {
      const stem = `pocket-${String(shot).padStart(3, '0')}-${w * scale}x${h * scale}`;
      if (kind === 'png' || kind === 'gray') {
        const pixels =
          kind === 'gray'
            ? renderFrame(
                frames[frameIndex],
                settings,
                { ...edit, grayscale: true },
                w,
                h,
              )
            : rendered[frameIndex];
        download(
          kind === 'gray' || edit.grayscale
            ? await grayscalePng(pixels, w, h, scale)
            : await png(pixelCanvas(pixels, w, h, scale)),
          `${stem}${kind === 'gray' || edit.grayscale ? '-grayscale' : ''}-frame-${frameIndex + 1}.png`,
        );
      } else if (kind === 'gif') {
        download(
          new Blob([encodeGif(rendered, w, h, DELAY)], { type: 'image/gif' }),
          `${stem}-${frames.length}frames.gif`,
        );
      } else {
        download(
          await webm(rendered, w, h, DELAY),
          `pocket-${shot}-${frames.length}frames.webm`,
        );
      }
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : 'Export failed. Please try again.',
      );
    } finally {
      setExporting(false);
    }
  }
  const config = {
      BG: { key: 'bg', label: 'BACKGROUND NOISE', min: 0, max: 6 },
      CNT: { key: 'contrast', label: 'CONTRAST', min: -3, max: 5 },
      EXP: { key: 'exposure', label: 'EXPOSURE', min: -6, max: 6 },
      DTH: { key: 'dither', label: 'DITHER', min: 0, max: 2 },
      PAL: { key: 'palette', label: 'PALETTE', min: 0, max: 4 },
    }[tab],
    k = config.key as keyof Settings,
    value = settings[k];
  const label =
    tab === 'BG'
      ? value === 0
        ? 'RAW'
        : value === 6
          ? 'CUTOUT'
          : 'CLEAN'
      : tab === 'DTH'
        ? ['NONE', 'BAYER', 'FLOYD–STEINBERG'][value]
        : tab === 'PAL'
          ? palettes[value].name
          : (value > 0 ? '+' : '') + value;
  const hasMasks = frames.length > 0 && frames.every((f) => f.mask),
    noPerson = hasMasks && frames[frameIndex].mask!.every((v) => v < 0.5);
  return (
    <main className="camera-app">
      <header>
        <div className="wordmark">
          <span className="camera-icon" aria-hidden="true">
            ▣
          </span>{' '}
          Bit Camera
          <span className="spark" aria-hidden="true">
            ✳
          </span>
        </div>
        <span className="edition">
          DIGITAL TOY
          <br />
          NO. 002
        </span>
      </header>
      <div className="rule" />
      <section className="camera-panel" aria-label="Pixel camera">
        <div className="status">
          <span>
            <i className={source === 'camera' && !review ? 'live' : ''} />
            {progress
              ? `REC ${progress}/${mode}`
              : review
                ? frames.length > 1
                  ? 'LOOP EDITOR'
                  : 'PHOTO EDITOR'
                : source === 'off'
                  ? 'STANDBY'
                  : source === 'image'
                    ? 'PHOTO INPUT'
                    : 'CAM 01'}
          </span>
          <span>
            {`${settings.tones}-${edit.grayscale && review ? 'GRAY' : 'TONE'}`}{' '}
            <b className="battery" aria-label="Decorative battery">
              ▰▰▰
            </b>
          </span>
        </div>
        <div className={'viewfinder ' + (review ? 'freeze' : '')}>
          <canvas
            ref={canvas}
            width={w}
            height={h}
            aria-label="Processed pixel preview"
          />
          {source === 'off' && !review && (
            <div className="start-screen">
              <span className="crosshair">＋</span>
              <p>
                A LITTLE LESS
                <br />
                RESOLUTION.
              </p>
              <button className="start-button" onClick={start} disabled={busy}>
                {busy ? 'CONNECTING…' : 'START CAMERA ↗'}
              </button>
              <span className="start-note">OR LOAD A PHOTO BELOW</span>
            </div>
          )}
          <span className="corner tl" />
          <span className="corner br" />
          {review && (
            <span className="photo-badge">
              {frames.length > 1
                ? `FRAME ${frameIndex + 1} / ${frames.length}`
                : 'EDIT YOUR SHOT'}
            </span>
          )}
        </div>
        <div className="frame-footer">
          <span>
            {w} × {h} PX
          </span>
          <span>
            {progress
              ? '● HOLD YOUR POSE…'
              : review
                ? '✳ ORIGINAL KEPT FOR EDITING'
                : '✳ MAKE SOMETHING SMALL'}
          </span>
        </div>
      </section>
      {message && (
        <p role="alert" className="notice">
          {message}
        </p>
      )}
      <fieldset disabled={locked} className="resolution-group">
        <legend>RESOLUTION</legend>
        <div className="choices">
          {resolutions.map((r, i) => (
            <button
              key={r.w}
              aria-pressed={resolution === i}
              onClick={() => setResolution(i)}
            >
              {r.w} × {r.h}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={locked} className="mode-group">
        <legend>COLOR TONES</legend>
        <div className="choices">
          {[2, 3, 4].map((tones) => (
            <button
              key={tones}
              aria-pressed={settings.tones === tones}
              onClick={() => setSettings((s) => ({ ...s, tones }))}
            >
              {tones} TONES
            </button>
          ))}
        </div>
      </fieldset>
      {!review && (
        <fieldset disabled={locked} className="mode-group">
          <legend>CAPTURE</legend>
          <div className="choices">
            {[1, 6, 8].map((n) => (
              <button
                key={n}
                aria-pressed={mode === n}
                onClick={() => setMode(n)}
                disabled={n > 1 && source === 'image'}
              >
                {n === 1 ? 'PHOTO' : `${n} FRAMES`}
              </button>
            ))}
          </div>
          {mode > 1 && (
            <p className="microcopy">
              4 frames/sec · {mode / 4}-second loop · no sound
            </p>
          )}
        </fieldset>
      )}
      {review && frames.length > 1 && (
        <div className="playback">
          <button disabled={exporting} onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Ⅱ PAUSE' : '▶ PLAY'}
          </button>
          <div className="frame-buttons">
            {frames.map((_, i) => (
              <button
                key={i}
                disabled={exporting}
                aria-label={`Frame ${i + 1}`}
                aria-pressed={frameIndex === i}
                onClick={() => {
                  setPlaying(false);
                  setFrameIndex(i);
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
      <fieldset disabled={locked} className="effect-controls">
        <nav className="tabs" aria-label="Camera settings">
          {names.map((n) => (
            <button key={n} aria-pressed={tab === n} onClick={() => setTab(n)}>
              <small>{n === tab ? '▼' : '·'}</small>
              {n}
            </button>
          ))}
        </nav>
        <section className="setting">
          <div className="setting-title">
            <span>{config.label}</span>
            <strong>{label}</strong>
          </div>
          <div className="stepper">
            <button
              disabled={value === config.min}
              onClick={() => setSettings((s) => ({ ...s, [k]: s[k] - 1 }))}
              aria-label={`Decrease ${config.label}`}
            >
              −
            </button>
            <div
              className="meter"
              role="meter"
              aria-label={config.label}
              aria-valuemin={config.min}
              aria-valuemax={config.max}
              aria-valuenow={value}
              aria-valuetext={label}
            >
              {Array.from({ length: config.max - config.min + 1 }, (_, i) => (
                <span
                  key={i}
                  className={i <= value - config.min ? 'filled' : ''}
                />
              ))}
            </div>
            <button
              disabled={value === config.max}
              onClick={() => setSettings((s) => ({ ...s, [k]: s[k] + 1 }))}
              aria-label={`Increase ${config.label}`}
            >
              +
            </button>
          </div>
          <div className="setting-help">
            {tab === 'BG' ? (
              review && edit.cutout ? (
                'FLAT CUTOUT OVERRIDES BACKGROUND NOISE'
              ) : (
                'RAW → CLEAN → CUTOUT'
              )
            ) : tab === 'PAL' ? (
              <span className="swatches">
                {toneIndices(settings.tones)
                  .map((i) => palettes[value].colors[i])
                  .map((c) => (
                    <i key={c} style={{ background: c }} />
                  ))}{' '}
                {edit.grayscale && review
                  ? 'GRAYSCALE PREVIEW ON'
                  : `${settings.tones} COLORS`}
              </span>
            ) : tab === 'DTH' ? (
              'NONE FOR CLEANER, SOLID TONES.'
            ) : (
              'FIND YOUR LIGHT.'
            )}
          </div>
        </section>
      </fieldset>
      {(settings.bg > 0 || review) && source !== 'off' && (
        <p className="model-status" role="status">
          {modelStatus === 'loading'
            ? '◌ LOADING PORTRAIT DETECTION…'
            : modelStatus === 'error'
              ? 'PORTRAIT DETECTION UNAVAILABLE · ORIGINAL BACKGROUND'
              : noPerson
                ? 'NO PERSON FOUND · CUTOUT CLEARS THE WHOLE FRAME'
                : modelStatus === 'ready'
                  ? '● PORTRAIT DETECTION READY'
                  : ''}
        </p>
      )}
      {review ? (
        <>
          <fieldset className="editor-controls" disabled={exporting}>
            <legend>FINISH YOUR {frames.length > 1 ? 'LOOP' : 'PHOTO'}</legend>
            <div className="choices">
              <button
                disabled={!hasMasks}
                aria-pressed={edit.cutout}
                onClick={() => setEdit((e) => ({ ...e, cutout: !e.cutout }))}
              >
                FLAT CUTOUT {edit.cutout ? 'ON' : 'OFF'}
              </button>
              <button
                aria-pressed={edit.grayscale}
                onClick={() =>
                  setEdit((e) => ({ ...e, grayscale: !e.grayscale }))
                }
              >
                GRAYSCALE {edit.grayscale ? 'ON' : 'OFF'}
              </button>
            </div>
            {!hasMasks && (
              <p className="microcopy">
                Flat background and outline need portrait detection.
              </p>
            )}
            {edit.cutout && (
              <>
                <div className="editor-row">
                  <span>BACKGROUND</span>
                  <div className="color-choices">
                    {toneIndices(settings.tones).map((i) => (
                      <button
                        key={i}
                        aria-label={`Background tone ${i + 1}`}
                        aria-pressed={
                          backgroundIndex(edit.background, settings.tones) === i
                        }
                        style={{
                          background: edit.grayscale
                            ? `rgb(${Math.round((toneIndices(settings.tones).indexOf(i) * 255) / (settings.tones - 1))} ${Math.round((toneIndices(settings.tones).indexOf(i) * 255) / (settings.tones - 1))} ${Math.round((toneIndices(settings.tones).indexOf(i) * 255) / (settings.tones - 1))})`
                            : palettes[settings.palette].colors[i],
                        }}
                        onClick={() =>
                          setEdit((e) => ({ ...e, background: i }))
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="editor-row">
                  <span>OUTLINE</span>
                  <div className="choices">
                    {[0, 1, 2, 3].map((n) => (
                      <button
                        key={n}
                        aria-pressed={edit.outline === n}
                        onClick={() => setEdit((e) => ({ ...e, outline: n }))}
                      >
                        {n === 0 ? 'OFF' : `${n} PX`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="editor-row">
                  <span>CLEANUP</span>
                  <div className="choices">
                    {[0, 1, 2].map((n) => (
                      <button
                        key={n}
                        aria-pressed={edit.cleanup === n}
                        onClick={() => setEdit((e) => ({ ...e, cleanup: n }))}
                      >
                        {['OFF', 'SOFT', 'STRONG'][n]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="editor-row">
                  <span>EDGE TRIM</span>
                  <div className="compact-step">
                    <button
                      disabled={edit.threshold <= 20}
                      onClick={() =>
                        setEdit((e) => ({ ...e, threshold: e.threshold - 5 }))
                      }
                      aria-label="Expand silhouette"
                    >
                      −
                    </button>
                    <span>{edit.threshold}</span>
                    <button
                      disabled={edit.threshold >= 80}
                      onClick={() =>
                        setEdit((e) => ({ ...e, threshold: e.threshold + 5 }))
                      }
                      aria-label="Tighten silhouette"
                    >
                      +
                    </button>
                  </div>
                </div>
                <p className="microcopy">
                  Higher trim tightens the silhouette. Outline uses the darkest
                  ink.
                </p>
              </>
            )}
            <button
              className="reference-preset"
              disabled={!hasMasks}
              onClick={() => {
                setSettings((s) => ({
                  ...s,
                  palette: 0,
                  dither: 0,
                  bg: 0,
                  tones: 3,
                }));
                setEdit({
                  ...defaultEdit,
                  cutout: true,
                  outline: 1,
                  background: 2,
                  cleanup: 2,
                });
              }}
            >
              ✳ REFERENCE LOOK · ORANGE + OUTLINE
            </button>
            <p className="microcopy">
              {frames.length > 1 ? 'Edits apply to every frame. ' : ''}Your
              original capture stays untouched.
            </p>
          </fieldset>
          <section className="review">
            <button
              className="shutter"
              disabled={exporting}
              onClick={() =>
                void save(
                  frames.length > 1 ? 'gif' : 'png',
                  frames.length > 1 ? 1 : 4,
                )
              }
            >
              {exporting
                ? 'EXPORTING…'
                : frames.length > 1
                  ? 'SAVE LOOP GIF'
                  : 'SAVE PNG'}
              <span>
                {frames.length > 1
                  ? `${frames.length} FRAMES ↗`
                  : `${w * 4} × ${h * 4} ↗`}
              </span>
            </button>
            {frames.length > 1 && (
              <button
                className="export-button"
                disabled={exporting}
                onClick={() => void save('webm')}
              >
                SAVE VIDEO · WEBM ↗
              </button>
            )}
            <button
              className="export-button"
              disabled={exporting}
              onClick={() => void save('gray', 4)}
            >
              SAVE GRAYSCALE PNG · {frames.length > 1 ? 'THIS FRAME' : 'PRINT'}{' '}
              ↗
            </button>
            <p className="microcopy">
              {settings.tones} neutral tones:{' '}
              {Array.from({ length: settings.tones }, (_, i) =>
                Math.round((i * 255) / (settings.tones - 1)),
              ).join(' / ')}
              . White = unprinted paper. Set final print size in your print
              software.
            </p>
            <div className="review-links">
              <button disabled={exporting} onClick={back}>
                ← RETAKE
              </button>
              <button disabled={exporting} onClick={() => void save('png', 1)}>
                SAVE {frames.length > 1 ? 'THIS FRAME' : 'NATIVE SIZE'} ↗
              </button>
            </div>
          </section>
        </>
      ) : (
        <div className="actions">
          <button
            className="secondary"
            onClick={() => {
              if (progress) {
                recording.current = null;
                setProgress(0);
              } else setSettings({ ...defaults });
            }}
          >
            <b>B</b>
            {progress ? 'CANCEL' : 'RESET'}
          </button>
          <button
            className="shutter"
            disabled={!ready || progress > 0 || busy}
            onClick={capture}
          >
            <b>A</b>
            {progress
              ? `RECORDING ${progress}/${mode}`
              : mode === 1
                ? 'TAKE PHOTO'
                : `RECORD ${mode} FRAMES`}
            <span>↗</span>
          </button>
        </div>
      )}
      <div className="source-actions">
        <button disabled={locked || busy} onClick={() => file.current?.click()}>
          ↑ LOAD PHOTO
        </button>
        <button
          disabled={locked || busy}
          onClick={() => {
            if (source === 'camera') {
              stop();
              setSource('off');
              if (!review) resetReview();
            } else void start();
          }}
        >
          {source === 'camera' ? '◼ STOP CAMERA' : '◉ USE WEBCAM'}
        </button>
      </div>
      <footer>
        <span>MADE OF PIXELS. KEPT ON YOUR DEVICE.</span>
        <span>
          SPACE = {review && frames.length > 1 ? 'PLAY / PAUSE' : 'SHUTTER'}
        </span>
      </footer>
      <video ref={video} muted playsInline hidden />
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </main>
  );
}
