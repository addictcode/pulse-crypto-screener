package dev.pulse.signal;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import dev.pulse.TestcontainersConfiguration;

@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class SignalHistoryIT {

    @Autowired
    private SignalHistory history;

    @Test
    void storesSignalsAndServesTheNewestFirst() {
        long now = System.currentTimeMillis();
        Signal first = history.record(new Signal(null, SignalType.PUMP, "HISTUSDT", now - 1_000, 1.0, 2.5, "HIST jumps", "d"));
        Signal second = history.record(new Signal(null, SignalType.VOLUME, "HISTUSDT", now, 1.1, 5.0, "HIST volume", "d"));

        assertThat(first.id()).isNotNull();
        assertThat(history.recent(2)).extracting(Signal::id).containsExactly(second.id(), first.id());
        assertThat(history.recentFor("HISTUSDT", 10)).extracting(Signal::title).containsExactly("HIST volume", "HIST jumps");
        assertThat(history.countSince(Instant.ofEpochMilli(now - 5_000))).isGreaterThanOrEqualTo(2);
    }

    @Test
    void cacheIsRebuiltFromTheDatabase() {
        Signal stored = history.record(new Signal(null, SignalType.FUNDING, "CACHEUSDT", System.currentTimeMillis(), 1, 0.2, "t", "d"));

        history.warmCache();

        assertThat(history.recent(SignalHistory.CACHED)).extracting(Signal::id).contains(stored.id());
    }
}
