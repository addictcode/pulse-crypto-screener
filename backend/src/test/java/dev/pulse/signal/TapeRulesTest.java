package dev.pulse.signal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.market.SymbolMetrics;

class TapeRulesTest {

    @Test
    void firesOnSmallerMovesThanTheCuratedSignals() {
        List<TapeItem> items = TapeRules.evaluate(row(1.2, 0.8, 1.0, 0.5), 0, 0, 5e6, 1);

        assertThat(items).extracting(TapeItem::kind).containsExactly(TapeKind.PUMP_1M);
        assertThat(SignalRules.evaluate(row(1.2, 0.8, 1.0, 0.5), 0, 0, null, 5e6, 1)).as("too small for an alert").isEmpty();
    }

    @Test
    void reportsEachKindWithItsDirection() {
        List<TapeItem> items = TapeRules.evaluate(row(-1.5, -2.4, 3.6, -3.0), 120_000, 40_000, 5e6, 1);

        assertThat(items).extracting(TapeItem::kind)
                .containsExactly(TapeKind.DUMP_1M, TapeKind.DUMP_5M, TapeKind.VOLUME, TapeKind.OI_DOWN, TapeKind.LIQ_LONGS);
        assertThat(items.getLast().value()).isEqualTo(160_000);
    }

    @Test
    void thinMarketsStayQuiet() {
        assertThat(TapeRules.evaluate(row(5, 5, 9, 9), 1e6, 0, 5e9, 1)).isEmpty();
    }

    private static SymbolMetrics row(double ch1m, double ch5m, double surge, double oiCh15m) {
        return new SymbolMetrics("WIFUSDT", 0.84, ch1m, ch5m, 1.0, 1.0, 2.0, 0.9, 0.8, 1e9, surge, 1.0, 0.01,
                null, 4e8, oiCh15m, 0);
    }
}
