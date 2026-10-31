# Pulse videos

Short vertical videos (1080×1920, 8.5 s, no sound) of real market events Pulse caught: a meme
caption, the ticker, the chart racing up to the signal candle, the move stamped on it with the
Pulse notification, then what the price really did over the next hour.

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
   npm run render                    # every event
   npm run render -- --only zil,t    # some events
   npm run render -- --variants 3    # each event told three ways
   npm run render -- --stills        # three PNG frames per video, to check the look quickly
   npm run studio                    # Remotion Studio, to work on the design
   ```

   Videos land in `out/`. Rendering uses the Chrome installed on the Mac.

## How a video is told

`src/story.ts` reads the hour after the signal from the candles and picks the plot: a rocket (it
kept going), a trap (it turned against the move) or flat, then a caption pair for it. The numbers
in every caption are the real ones.

Remotion is free for individuals and companies of up to three people.
