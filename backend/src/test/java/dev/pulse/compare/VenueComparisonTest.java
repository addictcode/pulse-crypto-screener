package dev.pulse.compare;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import dev.pulse.exchange.bybit.BybitQuote;
import dev.pulse.market.SymbolMetrics;

class VenueComparisonTest {

    @Test
    void fundingIsComparedPerEightHours() {
        // Binance pays +0.02% every 4 hours, Bybit +0.01% every 8: per 8 hours that is 0.04 against 0.01
        VenueGap gap = VenueComparison.compare(home(100, 0.02, 300e6), 4, new BybitQuote("WIFUSDT", 100.05, 0.01, 8, 100e6, 5e8));

        assertThat(gap.spread8h()).isEqualTo(0.03);
        assertThat(gap.spreadApr()).isEqualTo(32.9);
        assertThat(gap.gap()).isEqualTo(0.05);
        assertThat(gap.oiShare()).isEqualTo(0.25);
        assertThat(gap.homeHours()).isEqualTo(4);
    }

    @Test
    void missingNumbersStayMissing() {
        VenueGap gap = VenueComparison.compare(home(100, null, null), 8, new BybitQuote("WIFUSDT", 99, null, 8, null, 0));

        assertThat(gap.gap()).isEqualTo(-1.0);
        assertThat(gap.spread8h()).isNull();
        assertThat(gap.spreadApr()).isNull();
        assertThat(gap.oiShare()).isNull();
    }

    private static SymbolMetrics home(double price, Double funding, Double oi) {
        return new SymbolMetrics("WIFUSDT", price, 0.0, 0.0, 0.0, 0.0, 0.0, price, price, 1e9, 1.0, 1.0, funding, 0L, oi, 0.0, 0);
    }
}
