package dev.pulse.api;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.IntFunction;

/**
 * Short-lived cache for chart history. Switching between pairs, reopening a tab or several
 * browsers on the same pair would otherwise each cost a Binance request; the live candle is
 * drawn from the market stream anyway, so slightly old history is invisible.
 * <p>
 * History is always loaded in one of two depths and cut to the size asked for. Binance charts
 * klines by depth in steps (under 500 costs 2, up to 1000 costs 5), so the deeper load in a step
 * is free, and a caller can no longer make a fresh request out of every limit from 10 to 1000.
 */
final class CandleCache {

    static final int MAX_ENTRIES = 300;
    static final int SHALLOW = 499;
    static final int DEEP = 1000;

    private record Entry(long storedAt, List<CandleDto> candles) {
    }

    private final Map<String, Entry> entries = new ConcurrentHashMap<>();

    /** @param load fetches the given number of the latest candles from the exchange */
    List<CandleDto> get(String symbol, String interval, int limit, IntFunction<List<CandleDto>> load) {
        int depth = depth(limit);
        String key = symbol + ":" + interval + ":" + depth;
        long now = System.currentTimeMillis();
        Entry cached = entries.get(key);
        if (cached == null || now - cached.storedAt() >= ttl(interval).toMillis()) {
            if (entries.size() >= MAX_ENTRIES) {
                entries.clear(); // crude but bounded
            }
            cached = new Entry(now, load.apply(depth));
            entries.put(key, cached);
        }
        List<CandleDto> candles = cached.candles();
        return candles.subList(Math.max(0, candles.size() - limit), candles.size());
    }

    static int depth(int limit) {
        return limit <= SHALLOW ? SHALLOW : DEEP;
    }

    /** Minute candles go stale fastest. */
    static Duration ttl(String interval) {
        return "1m".equals(interval) ? Duration.ofSeconds(10) : Duration.ofSeconds(30);
    }
}
