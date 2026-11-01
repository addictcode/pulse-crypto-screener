# Pulse videos

Short vertical videos (1080×1920, 8.5 s, no sound) of real market events Pulse caught: a meme
caption, a quiet beat, the chart racing up to the signal candle, the move stamped on it with the
Pulse notification, then what the price really did over the next hour.

They are meant to be posted later and in any order, so none of them names the coin or shows a
date or a clock: the chart and every number are real, the coin stays anonymous.

Sound is left to TikTok: a trending sound picked there is licensed for the platform and helps the
video spread; a sound baked into the file is neither. What can be baked in are Pulse's own
effects: `npm run render -- --sfx` adds a quiet whoosh on every cut, a hit on every impact and a
click on countdowns, to `pulse-NNN-sfx.mp4` next to the silent files (with `captions-sfx.txt`).
The sounds are synthesised by ffmpeg (`node scripts/sfx.mjs` writes `public/sfx/*.wav`), so no
one else's rights are involved, and kept low so the trending sound goes on top.

## Making a batch

Events come from one of two sources, or both: they all land in `public/events.json`.

### From Binance's archive (anywhere, no database)

```bash
npm run archive -- --days 30 --max 60
```

`scripts/archive-events.mjs` takes the 120 most traded USDT perpetuals of the newest archived day
(`--pairs`), reads their minute candles from Binance's public archive for the last 30 days
(`--days`) and finds minutes where the price moved at least 5% in five minutes (`--min`). Per coin
and day only the strongest move is kept, at most three per coin (`--per-coin`); up to 60
(`--max`) of them, strongest first and pumps and dumps in turn, are **added** to
`public/events.json`. Events already there stay, the same coin and minute is never added twice.

What is thrown away: fresh listings (less than 100 minutes of history before the move, or a gap
in the minutes), a start price outside the day's range before the move (the rule Pulse's own
signals follow), and a crash with a rebound that would read as a pump. Every event then passes the
same candle check as the database ones (`confirm` in `scripts/archive.mjs`), and `npm test`
checks the whole file again.

The archive is `data.binance.vision`; the script reads the same bucket at its S3 address, which
some networks let through when the CDN is blocked (`ARCHIVE_URL` overrides it). Files appear about
a day late. Zips are cached in `.cache/`, so a second run downloads only what is new.

### From Pulse's signal table (on the Mac with the live database)

1. Candidates from the signal table (strongest pump or dump per coin over the last 25 days):
3. Render:

   ```bash
   caffeinate -i npm run render      # everything not rendered yet (about 30 s a video)
   npm run render -- --template guess,top3   # some templates only
   npm run render -- --max 10        # only numbers up to 10
   npm run render -- --stills --max 4  # three PNG frames per video, to check the look quickly
   npm run render -- --lang en       # the English set, to out/en/
   npm run render -- --shard 0/4     # every 4th video from the first: parallel jobs
   npm run studio                    # Remotion Studio, to work on the design
   ```

   Videos land in `out/` as `pulse-001.mp4`, `pulse-002.mp4`, ..., next to `captions.txt` with a
   post description and hashtags for each. A stopped render picks up where it left off: finished
   files are skipped. `out/manifest.json` remembers which video each file holds: when new events
   shift the plan, a number that now means another video is rendered again, not skipped. Rendering uses the Chrome installed on the Mac; `caffeinate` keeps the Mac
   from sleeping meanwhile.

   **Covers and other platforms.** Next to every video goes its cover `pulse-NNN.jpg`
   (1080×1920, frame 20: the hook is on screen in every template), for the cover picker of Reels
   and Shorts; a video already rendered gets a missing cover without rendering again, and
   `--no-covers` skips them. Next to `captions.txt` (TikTok) go `captions-reels.txt` (the same
   words with Reels' hashtags) and `captions-shorts.txt` (a title of at most 100 characters,
   with `#shorts` when it fits, and a description with the note and Shorts' hashtags).

### In GitHub Actions (no Mac)

The **video** workflow (`.github/workflows/video.yml`) renders a batch on GitHub's runners:

- Actions → video → Run workflow. Inputs: `templates`, `max` (numbers up to, 400 by default),
  `lang` (both, ru, en), `sfx`, `refresh_events` (search the archive for new events first, `days`
  of it), `shards` (parallel jobs per language, 8 by default);
- or push a branch `video-batch/<anything>` (e.g. `git push origin HEAD:video-batch/1`): the
  full batch on that commit's events, both languages, up to number 400;
- a pull request that changes the workflow renders six videos to prove it still works.

The videos are split over parallel jobs, one render tab each, and every one is checked by
`scripts/check.py`. The result is three artifacts, kept 14 days: `pulse-videos-<run>-ru` and
`-en` (the videos and their covers), and `pulse-videos-<run>-plan` (`captions.txt`,
`captions-reels.txt` and `captions-shorts.txt` for both languages, the
60-day `schedule.csv` and the `events.json` the batch was made from).

## Broken frames

With two or more render tabs at once, Chrome now and then handed over a frame of the wrong size
and the video showed the whole screen tiled for one frame, which reads as a flicker. Rendering
uses one tab (it is also faster on this Mac), and every video is checked by `scripts/check.py`
right after rendering and rendered again if a broken frame got through. To check files by hand:

```bash
python3 scripts/check.py out/pulse-*.mp4
```

## Templates

- **Event** (1-100): meme hook, a quiet beat, the chart to the signal candle, the punchline.
- **Guess** ("Угадай, что дальше"): the chart stops at the signal candle, a 3-2-1 countdown asks
  up or down, then the real next hour plays. Made for comments. Until the answer the price scale
  knows only the past, so it cannot give the answer away.
- **Top3**: three real moves counted down to the biggest, on light paper so it does not look like
  the rest of the feed.
- **Counter** ("Засекай: 5 минут"): a stopwatch from 00:00 to 05:00 and a huge running percent,
  counted from the price at 00:00, with the candles drawing underneath.

- **Timelapse** ("24 часа за 6 секунд"): the whole day around the event as a glowing line on
  night blue, a counter of hours gone (0 h to 24 h, never the time of day), and the day stopping
  at the event with the five minute move stamped on it. The day comes from `public/days.json`:
  24 hours of five minute bars per event, built from the archive by `scripts/days.mjs` (the
  archive search runs it by itself; after `npm run events` run `node scripts/days.mjs`). Events
  without a full day in the archive get no time-lapse.

- **Split** ("Было / стало"): the screen split down the middle, the minutes before the move in
  grey on the left, the five minutes of the move in colour on the right, on one price scale. Only
  events whose minutes before moved less than a third of the move get one (`src/split.ts`).

- **Volume** ("Объём взорвался"): violet volume bars at a scale made for ordinary minutes, the
  burst growing through the top with its multiple counting up (the biggest minute of the five
  against the average minute before, from the candles' USDT turnover), the scale stepping back to
  fit it, then the price underneath. Only bursts of five times the average or more
  (`src/volume.ts`).

- **Traps** ("Серия ловушек"): three moves that broke out and came back within the hour, one
  after another, between caution tape. The three are always within a week of each other, because
  one hook says "3 раза за неделю" (`src/traps.ts`); next threes share one event.

- **Pulse** ("Пульс рынка"): a dark grid of 30 unnamed tiles, the event's coin and the 29 most
  traded others, lighting up with each coin's real five minute change, minute by minute through
  the hour up to the event; the event's tile flares, grows to fill the screen and becomes its
  chart. The hour comes from `public/pulse.json` (`scripts/pulse.mjs`, run by the archive search
  too; no coin names are stored). Only events whose tile is the biggest of the thirty at the
  event and at least 4% get one. The tile, the zoom and the stamp show the same number: the
  close-to-close change over five minutes.

The templates take turns from number 1 on (event, guess, counter, top3, timelapse, split, volume,
traps, pulse, ...),
so neighbouring videos never share a format and any first few show all of them.

## Languages

Every word in the frames and the post descriptions lives in `src/text.ts`, by language: `ru` (in
`out/`) and `en` (in `out/en/`, the same numbers and events). The English set is written as memes
for English-speaking crypto TikTok (POV, "Nobody: / The market:", "Expectation / Reality"), not
translated line by line; its hashtags are #crypto #trading #bitcoin #altcoins #futures #binance.
A new line of text goes into both languages.

## How a video is told

`src/story.ts` reads the hour after the signal from the candles and picks the plot: a rocket (it
kept going), a trap (it turned against the move) or flat. Each plot has five hook and punchline
pairs per language that belong together ("Ожидание:" then "Реальность:"); videos next to each other always get
different ones. The numbers in every caption are the real ones.

Remotion is free for individuals and companies of up to three people.
