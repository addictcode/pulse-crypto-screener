import { Audio, Sequence, staticFile } from 'remotion';

/**
 * Pulse's own sound effects (scripts/sfx.mjs) on the frames where the picture cuts or hits. Off
 * unless a video is rendered with --sfx; quiet, because the trending sound added in TikTok goes
 * on top.
 */
export type Cue = { at: number; kind: 'hit' | 'whoosh' | 'click' };

const VOLUME: Record<Cue['kind'], number> = { hit: 0.3, whoosh: 0.45, click: 0.18 };
const LENGTH: Record<Cue['kind'], number> = { hit: 18, whoosh: 12, click: 3 };

/** Cuts at the starts of all scenes but the first, from their lengths. */
export function cuts(lengths: number[]): Cue[] {
  const out: Cue[] = [];
  let at = 0;
  for (const length of lengths.slice(0, -1)) {
    at += length;
    out.push({ at, kind: 'whoosh' });
  }
  return out;
}

export const Cues = ({ on, list }: { on?: boolean; list: Cue[] }) =>
  on ? (
    <>
      {list.map((cue) => (
        <Sequence key={`${cue.kind}${cue.at}`} from={cue.at} durationInFrames={LENGTH[cue.kind]} layout="none">
          <Audio src={staticFile(`sfx/${cue.kind}.wav`)} volume={VOLUME[cue.kind]} />
        </Sequence>
      ))}
    </>
  ) : null;
