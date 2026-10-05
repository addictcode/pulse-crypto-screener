package dev.pulse.account;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;

class DeliverySettingsTest {

    private static final Instant NOW = Instant.parse("2026-10-05T12:00:00Z");
    private static final Signal PUMP = new Signal(1L, SignalType.PUMP, "WIFUSDT", 0, 1, 2.6, "", "");

    @Test
    void defaultsDeliverEverything() {
        assertThat(settings(null, false, Set.of(), Set.of(), Map.of()).wants(PUMP, NOW)).isTrue();
    }

    @Test
    void muteHoldsUntilItsEnd() {
        assertThat(settings(NOW.plusSeconds(60), false, Set.of(), Set.of(), Map.of()).wants(PUMP, NOW)).isFalse();
        assertThat(settings(NOW.minusSeconds(60), false, Set.of(), Set.of(), Map.of()).wants(PUMP, NOW)).isTrue();
    }

    @Test
    void disabledTypesAndHigherThresholdsFilter() {
        assertThat(settings(null, false, Set.of(), Set.of(SignalType.PUMP), Map.of()).wants(PUMP, NOW)).isFalse();
        assertThat(settings(null, false, Set.of(), Set.of(), Map.of(SignalType.PUMP, 3.0)).wants(PUMP, NOW)).isFalse();
        assertThat(settings(null, false, Set.of(), Set.of(), Map.of(SignalType.PUMP, 2.5)).wants(PUMP, NOW)).isTrue();
    }

    @Test
    void watchlistScopeKeepsOnlyWatchedPairs() {
        assertThat(settings(null, true, Set.of("SOLUSDT"), Set.of(), Map.of()).wants(PUMP, NOW)).isFalse();
        assertThat(settings(null, true, Set.of("WIFUSDT"), Set.of(), Map.of()).wants(PUMP, NOW)).isTrue();
    }

    private static DeliverySettings settings(Instant muted, boolean watchOnly, Set<String> watchlist, Set<SignalType> disabled,
                                             Map<SignalType, Double> thresholds) {
        return new DeliverySettings(1, 42L, muted, watchOnly, watchlist, disabled, thresholds);
    }
}
