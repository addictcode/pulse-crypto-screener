package dev.pulse.api;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.market.MarketStore;
import dev.pulse.market.Positioning;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;

/**
 * Open interest, long/short ratios and funding history for the panes under the chart. The
 * exchange refreshes these every five minutes at best, so a minute of caching loses nothing and
 * keeps several browsers on one pair from each costing five requests.
 */
@RestController
@RequestMapping("/api/positioning")
@RequiredArgsConstructor
public class PositioningController {

    static final Set<String> PERIODS = Set.of("5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d");
    static final long TTL_MS = 60_000;
    static final int MAX_ENTRIES = 200;

    private record Entry(long storedAt, Positioning value) {
    }

    private final List<ExchangeAdapter> exchanges;
    private final MarketStore store;
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();

    @GetMapping
    public Positioning positioning(@RequestParam String symbol,
                                   @RequestParam(defaultValue = "5m") String period,
                                   @RequestParam(defaultValue = "300") @Min(10) @Max(500) int limit) {
        if (!PERIODS.contains(period)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "period must be one of " + PERIODS);
        }
        // only symbols we track: keeps the endpoint from becoming an open proxy to the exchange
        if (!store.isListed(symbol)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown symbol " + symbol);
        }
        ExchangeAdapter exchange = exchanges.stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "no exchange connected"));
        String key = symbol + ":" + period + ":" + limit;
        long now = System.currentTimeMillis();
        Entry cached = cache.get(key);
        if (cached != null && now - cached.storedAt() < TTL_MS) {
            return cached.value();
        }
        Positioning fresh = exchange.positioning(symbol, period, limit);
        if (cache.size() >= MAX_ENTRIES) {
            cache.clear(); // crude but bounded, like the candle cache
        }
        cache.put(key, new Entry(now, fresh));
        return fresh;
    }
}
