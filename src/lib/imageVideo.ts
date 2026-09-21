// Turns a few still images into a short, silent MP4 (H.264) entirely in the browser,
// using WebCodecs + mp4-muxer. No AI is involved, so the product's real design is
// shown exactly as it is (nothing gets warped or re-drawn). Built for Etsy/Shopify
// listing videos: 1080x1080, 10 seconds, no sound (Etsy strips sound anyway).
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export const VIDEO_SIZE = 1080;
export const VIDEO_SECONDS = 10;
export const VIDEO_FPS = 30;
export const MAX_VIDEO_IMAGES = 5;

// ─── Which images actually sell ───────────────────────────────────────────────

export type ImageKind =
  | "hero" | "mockup" | "features" | "social" | "photo" | "options"
  | "promise" | "shipping" | "reference";

export interface ClassifiedImage {
  kind: ImageKind;
  label: string;
  // Lower is better. 99 means "leave it out of the video by default".
  rank: number;
}

// Filenames and alt text are the only signals we have. Cards made by this app carry
// their type in both (e.g. "...-features.webp", alt "... - Made With Care"), and
// mockups say "mockup" / "lifestyle".
export function classifyProductImage(
  src: string,
  alt: string | null | undefined,
  position: number,
): ClassifiedImage {
  let file = "";
  try {
    file = decodeURIComponent(new URL(src).pathname.split("/").pop() || "");
  } catch {
    file = src;
  }
  const text = `${file} ${alt || ""}`.toLowerCase();

  // Things that don't help sell the item visually: shipping/promise cards (the store
  // already covers those) and supplier reference pictures like size charts.
  if (/-shipping\b|shipping info|when will it arrive/.test(text)) return { kind: "shipping", label: "Shipping card (skipped)", rank: 99 };
  if (/-promise\b|our promise/.test(text)) return { kind: "promise", label: "Promise card (skipped)", rank: 99 };
  if (/size[-_ ]?chart|sizing|measurement|dimension|packag|care[-_ ]?instruction|returns?\b/.test(text)) {
    return { kind: "reference", label: "Reference photo (skipped)", rank: 99 };
  }

  if (position === 1) return { kind: "hero", label: "Main photo", rank: 0 };
  if (/mockup|lifestyle|styled/.test(text)) return { kind: "mockup", label: "Lifestyle mockup", rank: 1 };
  if (/-features\b|made with care/.test(text)) return { kind: "features", label: "Features card", rank: 2 };
  if (/-social\b|why you'?ll love it/.test(text)) return { kind: "social", label: "Why you'll love it card", rank: 3 };
  if (/-variations\b|design options|design variations/.test(text)) return { kind: "options", label: "Design options card", rank: 5 };
  return { kind: "photo", label: "Product photo", rank: 4 };
}

// The best images for the video, in the order they should play: main photo first,
// then lifestyle mockups, then the features card, and so on. Returns indexes into
// the list that was passed in.
export function pickBestImages(
  images: { src: string; alt?: string | null; position?: number }[],
  max = MAX_VIDEO_IMAGES,
): number[] {
  return images
    .map((img, index) => ({ index, ...classifyProductImage(img.src, img.alt, img.position ?? index + 1) }))
    .filter((c) => c.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, max)
    .map((c) => c.index);
}

// ─── Timing (pure, so it can be tested without a browser) ─────────────────────

export interface SlideLayer {
  index: number;
  alpha: number;
  // 0..1 through this slide's slow zoom.
  progress: number;
}

// What to draw at time `t` (seconds): the current slide, plus the next one fading in
// over the last `fade` seconds of the current slide.
export function slideLayersAt(t: number, count: number, total = VIDEO_SECONDS, fade = 0.5): SlideLayer[] {
  const slideDur = total / count;
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const i = Math.min(count - 1, Math.max(0, Math.floor(t / slideDur)));
  const layers: SlideLayer[] = [
    { index: i, alpha: 1, progress: clamp01((t - i * slideDur) / (slideDur + fade)) },
  ];
  const fadeStart = (i + 1) * slideDur - fade;
  if (i < count - 1 && t > fadeStart) {
    layers.push({
      index: i + 1,
      alpha: clamp01((t - fadeStart) / fade),
      progress: clamp01((t - (i + 1) * slideDur) / (slideDur + fade)),
    });
  }
  return layers;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

interface PreparedSlide {
  bitmap: ImageBitmap;
  // Soft blurred copy of the image, drawn behind it so non-square images (like the
  // landscape cards) fill the square frame without cropping any of their text.
  background: HTMLCanvasElement;
}

function prepareSlide(bitmap: ImageBitmap): PreparedSlide {
  const background = document.createElement("canvas");
  background.width = VIDEO_SIZE;
  background.height = VIDEO_SIZE;
  const ctx = background.getContext("2d")!;
  ctx.fillStyle = "#151515";
  ctx.fillRect(0, 0, VIDEO_SIZE, VIDEO_SIZE);
  if ("filter" in ctx) {
    const cover = Math.max(VIDEO_SIZE / bitmap.width, VIDEO_SIZE / bitmap.height) * 1.2;
    const w = bitmap.width * cover;
    const h = bitmap.height * cover;
    ctx.filter = "blur(36px)";
    ctx.drawImage(bitmap, (VIDEO_SIZE - w) / 2, (VIDEO_SIZE - h) / 2, w, h);
    ctx.filter = "none";
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 0, VIDEO_SIZE, VIDEO_SIZE);
  }
  return { bitmap, background };
}

function drawLayer(ctx: CanvasRenderingContext2D, slide: PreparedSlide, layer: SlideLayer) {
  const { bitmap, background } = slide;
  const fit = Math.min(VIDEO_SIZE / bitmap.width, VIDEO_SIZE / bitmap.height);
  const zoom = 1 + 0.04 * layer.progress; // gentle push-in
  const w = bitmap.width * fit * zoom;
  const h = bitmap.height * fit * zoom;
  ctx.globalAlpha = layer.alpha;
  ctx.drawImage(background, 0, 0);
  ctx.drawImage(bitmap, (VIDEO_SIZE - w) / 2, (VIDEO_SIZE - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

// ─── Encoding ─────────────────────────────────────────────────────────────────

const H264_CODECS = ["avc1.640028", "avc1.4d0028", "avc1.42e028"];

export function canMakeVideos(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

export async function renderImagesToMp4(
  bitmaps: ImageBitmap[],
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  if (!bitmaps.length) throw new Error("Pick at least one image first.");
  if (!canMakeVideos()) throw new Error("This browser can't make MP4 videos. Use Chrome or Edge.");

  let config: VideoEncoderConfig | null = null;
  for (const codec of H264_CODECS) {
    const candidate: VideoEncoderConfig = {
      codec, width: VIDEO_SIZE, height: VIDEO_SIZE, bitrate: 5_000_000, framerate: VIDEO_FPS,
    };
    if ((await VideoEncoder.isConfigSupported(candidate)).supported) { config = candidate; break; }
  }
  if (!config) throw new Error("This browser can't encode H.264 video. Use Chrome or Edge.");

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: VIDEO_SIZE, height: VIDEO_SIZE },
    fastStart: "in-memory",
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e instanceof Error ? e : new Error(String(e)); },
  });
  encoder.configure(config);

  const canvas = document.createElement("canvas");
  canvas.width = VIDEO_SIZE;
  canvas.height = VIDEO_SIZE;
  const ctx = canvas.getContext("2d")!;
  const slides = bitmaps.map(prepareSlide);
  const totalFrames = VIDEO_SECONDS * VIDEO_FPS;

  for (let f = 0; f < totalFrames; f++) {
    if (encodeError) throw encodeError;
    const t = f / VIDEO_FPS;
    ctx.fillStyle = "#151515";
    ctx.fillRect(0, 0, VIDEO_SIZE, VIDEO_SIZE);
    for (const layer of slideLayersAt(t, slides.length)) drawLayer(ctx, slides[layer.index], layer);

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((f * 1_000_000) / VIDEO_FPS),
      duration: Math.round(1_000_000 / VIDEO_FPS),
    });
    encoder.encode(frame, { keyFrame: f % VIDEO_FPS === 0 });
    frame.close();

    // Don't let the encoder queue grow without bound, and let the page breathe.
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    if (f % 6 === 0) {
      onProgress?.(f / totalFrames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
  muxer.finalize();
  onProgress?.(1);
  return new Blob([target.buffer], { type: "video/mp4" });
}
