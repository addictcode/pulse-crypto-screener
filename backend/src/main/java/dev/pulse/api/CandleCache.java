package dev.pulse.api;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * Short-lived cache for chart history. Switching between pairs, reopening a tab or several
 * browsers on the same pair would otherwise each cost a Binance request; the live candle is
 * drawn from the market stream anyway, so slightly old history is invisible.
 */
final class CandleCache {

    static final int MAX_ENTRIES = 300;

    private record Entry(long storedAt, List<CandleDto> candles) {
    }

    private final Map<String, Entry> entries = new ConcurrentHashMap<>();

    List<CandleDto> get(String symbol, String interval, int limit, Supplier<List<CandleDto>> load) {
        String key = symbol + ":" + interval + ":" + limit;
        long now = System.currentTimeMillis();
        Entry cached = entries.get(key);
        if (cached != null && now - cached.storedAt() < ttl(interval).toMillis()) {
            return cached.candles();
        }
        List<CandleDto> fresh = load.get();
        if (entries.size() >= MAX_ENTRIES) {
            entries.clear(); // crude but bounded; a personal tool never gets near this
        }
        entries.put(key, new Entry(now, fresh));
        return fresh;
    }

    /** Minute candles go stale fastest. */
    static Duration ttl(String interval) {
        return "1m".equals(interval) ? Duration.ofSeconds(10) : Duration.ofSeconds(30);
    }
}
