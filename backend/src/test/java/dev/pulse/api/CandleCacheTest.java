package dev.pulse.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;

class CandleCacheTest {

    private final CandleCache cache = new CandleCache();
    private final List<Integer> loads = new ArrayList<>();

    @Test
    void repeatedRequestsHitTheExchangeOnce() {
        cache.get("WIFUSDT", "5m", 300, this::load);
        cache.get("WIFUSDT", "5m", 300, this::load);

        assertThat(loads).hasSize(1);
    }

    @Test
    void differentPairsAndIntervalsAreSeparate() {
        cache.get("WIFUSDT", "5m", 300, this::load);
        cache.get("WIFUSDT", "1h", 300, this::load);
        cache.get("SOLUSDT", "5m", 300, this::load);

        assertThat(loads).hasSize(3);
    }

    @Test
    void everyLimitInADepthStepSharesOneLoad() {
        for (int limit = 10; limit <= CandleCache.SHALLOW; limit += 7) {
            cache.get("SOLUSDT", "5m", limit, this::load);
        }
        for (int limit = 500; limit <= CandleCache.DEEP; limit += 7) {
            cache.get("SOLUSDT", "5m", limit, this::load);
        }

        assertThat(loads).containsExactly(CandleCache.SHALLOW, CandleCache.DEEP);
    }

    @Test
    void theLatestCandlesAreReturnedInTheSizeAskedFor() {
        List<CandleDto> candles = cache.get("SOLUSDT", "5m", 180, this::load);

        assertThat(candles).hasSize(180);
        assertThat(candles.getLast().time()).isEqualTo(CandleCache.SHALLOW - 1);
    }

    @Test
    void minuteCandlesExpireSooner() {
        assertThat(CandleCache.ttl("1m")).isLessThan(CandleCache.ttl("1h"));
    }

    private List<CandleDto> load(int depth) {
        loads.add(depth);
        return IntStream.range(0, depth).mapToObj(i -> new CandleDto(i, 1, 1, 1, 1, 1)).toList();
    }
}
