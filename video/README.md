# Pulse videos

Short vertical videos (1080×1920, 8.5 s, no sound) of real market events Pulse caught: a meme
caption, a quiet beat, the chart racing up to the signal candle, the move stamped on it with the
Pulse notification, then what the price really did over the next hour.

They are meant to be posted later and in any order, so none of them names the coin or shows a
date or a clock: the chart and every number are real, the coin stays anonymous.

Sound is left to TikTok: a trending sound picked there is licensed for the platform and helps the
video spread; a sound baked into the file is neither.

## Making a batch

1. Candidates from the signal table (strongest pump or dump per coin over the last 25 days):

   ```bash
   docker exec pulse-postgres-1 psql -U pulse -d pulse -At -c "
   select coalesce(json_agg(e), '[]') from (
     select distinct on (symbol) symbol, type, (extract(epoch from fired_at)*1000)::bigint as time, price, value, ret_5m, ret_15m, ret_1h
     from signal where type in ('PUMP','DUMP') and fired_at > now() - interval '25 days' and ret_1h is not null and value >= 4
     order by symbol, value desc) e" > scripts/candidates.json
   ```

2. Check them against Binance's minute candles; only moves the candles confirm are kept:

   ```bash
   npm run events -- 40
   ```

   Before 31 October 2026 most stored pumps and dumps were false (a spliced stream frame put one
   coin's price on another), so this check is not optional.

3. Render:

   ```bash
   caffeinate -i npm run render      # everything not rendered yet (about 30 s a video)
   npm run render -- --template guess,top3   # some templates only
   npm run render -- --max 10        # only numbers up to 10
   npm run render -- --stills --max 4  # three PNG frames per video, to check the look quickly
   npm run studio                    # Remotion Studio, to work on the design
   ```

   Videos land in `out/` as `pulse-001.mp4`, `pulse-002.mp4`, ..., next to `captions.txt` with a
   post description and hashtags for each. A stopped render picks up where it left off: finished
   files are skipped. Rendering uses the Chrome installed on the Mac; `caffeinate` keeps the Mac
   from sleeping meanwhile.

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

From 101 on the three take turns, so neighbouring videos never share a format.

## How a video is told

`src/story.ts` reads the hour after the signal from the candles and picks the plot: a rocket (it
kept going), a trap (it turned against the move) or flat. Each plot has five hook and punchline
pairs that belong together ("Ожидание:" then "Реальность:"); videos next to each other always get
different ones. The numbers in every caption are the real ones.

Remotion is free for individuals and companies of up to three people.
