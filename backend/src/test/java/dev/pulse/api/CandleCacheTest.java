package dev.pulse.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

class CandleCacheTest {

    private final CandleCache cache = new CandleCache();
    private final AtomicInteger loads = new AtomicInteger();

    @Test
    void repeatedRequestsHitTheExchangeOnce() {
        cache.get("WIFUSDT", "5m", 300, this::load);
        cache.get("WIFUSDT", "5m", 300, this::load);

        assertThat(loads).hasValue(1);
    }

    @Test
    void differentPairsIntervalsAndLimitsAreSeparate() {
        cache.get("WIFUSDT", "5m", 300, this::load);
        cache.get("WIFUSDT", "1h", 300, this::load);
        cache.get("SOLUSDT", "5m", 300, this::load);
        cache.get("SOLUSDT", "5m", 100, this::load);

        assertThat(loads).hasValue(4);
    }

    @Test
    void minuteCandlesExpireSooner() {
        assertThat(CandleCache.ttl("1m")).isLessThan(CandleCache.ttl("1h"));
    }

    private List<CandleDto> load() {
        loads.incrementAndGet();
        return List.of(new CandleDto(1, 1, 1, 1, 1, 1));
    }
}
