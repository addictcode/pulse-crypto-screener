# Pulse videos

Short vertical videos (1080×1920, 8.5 s, no sound) of real market events Pulse caught: a meme
caption, a quiet beat, the chart racing up to the signal candle, the move stamped on it with the
Pulse notification, then what the price really did over the next hour.

They are meant to be posted later and in any order, so none of them names the coin or shows a
date or a clock: the chart and every number are real, the coin stays anonymous.

Sound is left to TikTok: a trending sound picked there is licensed for the platform and helps the
video spread; a sound baked into the file is neither.

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
   npm run studio                    # Remotion Studio, to work on the design
   ```

   Videos land in `out/` as `pulse-001.mp4`, `pulse-002.mp4`, ..., next to `captions.txt` with a
   post description and hashtags for each. A stopped render picks up where it left off: finished
   files are skipped. `out/manifest.json` remembers which video each file holds: when new events
   shift the plan, a number that now means another video is rendered again, not skipped. Rendering uses the Chrome installed on the Mac; `caffeinate` keeps the Mac
   from sleeping meanwhile.

### In GitHub Actions (no Mac)

The **video** workflow (`.github/workflows/video.yml`) renders a batch on GitHub's runner: Actions
→ video → Run workflow. Inputs: `templates`, `max` (numbers up to), `refresh_events` (search the
archive for new events first, `days` of it). Every video is checked by `scripts/check.py`, and
the batch comes out as the artifact `pulse-videos-<run>`: the videos, `captions.txt` and the
`events.json` they were made from. Artifacts are kept 14 days. A pull request that changes the
workflow renders six videos to prove it still works.

## Checks

`npm test` (also in CI, job `video`): how `src/story.ts` picks the plot and signs the numbers,
that no text in either language has a ticker, a date or a time of day and the English one no
Cyrillic, the archive search on a small synthetic archive, and the candle check of every event in
`public/events.json`. CI then renders the first video of every template in both languages
(`npm run render -- --per-template 1`) and runs `check.py` on them: a broken template fails the
job. The videos are kept as the `video-check` artifact for a week.

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

The four take turns from number 1 on (event, guess, counter, top3, event, ...), so neighbouring
videos never share a format and any first few show all of them.

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
