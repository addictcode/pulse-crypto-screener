/**
 * Records the recording frame straight to a video file, so a clip needs no screen recorder and
 * no cropping afterwards. The browser asks for permission to capture this tab every time; where
 * Region Capture exists (Chrome) the video is cut to the frame itself, elsewhere it is the tab.
 */

/** Long enough for a short video, short enough that a forgotten recording does not fill the disk. */
export const MAX_SECONDS = 90;
/** How long the window takes to make room for the browser's sharing bar. */
const SETTLE_MS = 500;

/** Chrome writes MP4 since 2024, which TikTok and Telegram take as is; WebM is the fallback. */
const TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export function pickType(supported: (type: string) => boolean): string | null {
  return TYPES.find(supported) ?? null;
}

/** pulse-WIF-2026-10-31-1422.mp4 */
export function fileName(symbol: string, type: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  return `pulse-${symbol.replace(/USDT$/, '')}-${stamp}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}

// Region Capture is not in the DOM typings yet
interface CropTargetStatic {
  fromElement(element: Element): Promise<unknown>;
}
type CroppableTrack = MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> };

export interface RecordingState {
  recording: boolean;
  seconds: number;
  /** false when the browser could only record the whole tab */
  cropped: boolean;
}

export class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private timer = 0;
  private started = 0;
  private cropped = false;
  private readonly onChange: (state: RecordingState) => void;
  private readonly onError: (reason: 'unsupported') => void;

  /**
   * @param onChange told when a recording starts, every second while it runs, and when it ends
   * @param onError  told when this browser cannot record at all
   */
  constructor(onChange: (state: RecordingState) => void, onError: (reason: 'unsupported') => void) {
    this.onChange = onChange;
    this.onError = onError;
  }

  get recording() {
    return this.recorder !== null;
  }

  async toggle(frame: Element, symbol: string) {
    if (this.recorder) {
      this.stop();
      return;
    }
    const type = typeof MediaRecorder === 'undefined' ? null : pickType((t) => MediaRecorder.isTypeSupported(t));
    if (!type || !navigator.mediaDevices?.getDisplayMedia) {
      this.onError('unsupported');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
        // Chrome: offer this tab first and keep it in the list
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions);
    } catch {
      return; // the person said no; nothing to report
    }
    const track = stream.getVideoTracks()[0] as CroppableTrack;
    const CropTarget = (window as unknown as { CropTarget?: CropTargetStatic }).CropTarget;
    this.cropped = false;
    if (CropTarget && track.cropTo) {
      try {
        await track.cropTo(await CropTarget.fromElement(frame));
        // Chrome's "sharing this tab" bar has just taken some height and the frame shrinks with
        // the window: measure once that has settled. The stream otherwise keeps the tab's size
        // and squeezes the crop into it.
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        const box = frame.getBoundingClientRect();
        const even = (v: number) => Math.round((v * devicePixelRatio) / 2) * 2;
        await track.applyConstraints({ width: even(box.width), height: even(box.height) }).catch(() => {});
        this.cropped = true;
      } catch {
        // another tab or window was picked: it cannot be cut to our frame, record it whole
      }
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (chunks.length) download(new Blob(chunks, { type: type.split(';')[0] }), fileName(symbol, type));
    };
    // the browser's own "stop sharing" button ends it as well
    track.addEventListener('ended', () => this.stop());
    recorder.start(1_000);
    this.recorder = recorder;
    this.stream = stream;
    this.started = Date.now();
    this.report();
    this.timer = window.setInterval(() => {
      if (this.seconds() >= MAX_SECONDS) this.stop();
      else this.report();
    }, 1_000);
  }

  stop() {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = null;
    clearInterval(this.timer);
    if (recorder.state !== 'inactive') recorder.stop();
    else this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.onChange({ recording: false, seconds: 0, cropped: this.cropped });
  }

  private seconds() {
    return Math.floor((Date.now() - this.started) / 1000);
  }

  private report() {
    this.onChange({ recording: true, seconds: this.seconds(), cropped: this.cropped });
  }
}

function download(blob: Blob, name: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
