package dev.pulse.signal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.depth.BookSide;
import dev.pulse.depth.Wall;
import dev.pulse.market.SymbolMetrics;

class SignalRulesTest {

    private static final double MIN_VOLUME = 5_000_000;

    @Test
    void quietMarketFiresNothing() {
        assertThat(evaluate(row(0.4, 1.2, 0.8, 0.01), 0, 0, null)).isEmpty();
    }

    @Test
    void pumpOnFiveMinuteMoveWithReadableTitle() {
        List<Signal> signals = evaluate(row(2.84, 1.1, 0.5, 0.01), 0, 0, null);

        assertThat(signals).singleElement().satisfies(s -> {
            assertThat(s.type()).isEqualTo(SignalType.PUMP);
            assertThat(s.value()).isEqualTo(2.84);
            assertThat(s.title()).isEqualTo("WIF jumps 2.8% in five minutes");
            assertThat(s.detail()).isEqualTo("Price 0.8421, +9.6% on the day. Volume 1.1× the hourly pace, open interest +0.5% over 15 minutes.");
        });
    }

    @Test
    void dumpVolumeOpenInterestAndFundingCanFireTogether() {
        List<Signal> signals = evaluate(row(-3.1, 6.2, -5.0, -0.21), 0, 0, null);

        assertThat(signals).extracting(Signal::type)
                .containsExactlyInAnyOrder(SignalType.DUMP, SignalType.VOLUME, SignalType.OPEN_INTEREST, SignalType.FUNDING);
        assertThat(signals).extracting(Signal::title).contains(
                "WIF falls 3.1% in five minutes",
                "Open interest in WIF drops 5.0% in 15 minutes",
                "WIF funding at −0.210%, shorts pay longs");
    }

    @Test
    void everySignalSaysWhichWayItPoints() {
        assertThat(evaluate(row(-3.1, 6.2, -5.0, -0.21), 0, 0, null)).extracting(Signal::type, Signal::direction)
                .containsExactlyInAnyOrder(
                        tuple(SignalType.DUMP, -1),
                        tuple(SignalType.VOLUME, -1),
                        tuple(SignalType.OPEN_INTEREST, -1),
                        tuple(SignalType.FUNDING, -1));
        // liquidated shorts are forced buys, a bid wall is support: both point up
        assertThat(evaluate(row(0, 1, 0, 0.01), 150_000, 500_000, null)).singleElement().extracting(Signal::direction).isEqualTo(1);
        Wall bid = new Wall("WIFUSDT", BookSide.BID, 0.8400, 2_100_000, -0.25, 22, 600, 4.0);
        assertThat(evaluate(row(0, 1, 0, 0.01), 0, 0, bid)).singleElement().extracting(Signal::direction).isEqualTo(1);
    }

    @Test
    void contextLineDoesNotRepeatTheTitle() {
        Signal volume = evaluate(row(0.2, 6.2, 0.5, 0.01), 0, 0, null).getFirst();

        assertThat(volume.type()).isEqualTo(SignalType.VOLUME);
        assertThat(volume.detail()).isEqualTo("Price 0.8421, +9.6% on the day. Open interest +0.5% over 15 minutes.");
    }

    @Test
    void thinMarketsAreIgnored() {
        SymbolMetrics thin = new SymbolMetrics("DUSTUSDT", 0.01, 0.0, 9.0, 9.0, 9.0, 9.0, null, null,
                1_000_000, 9.0, 1.0, 0.5, null, null, null, 0);

        assertThat(evaluate(thin, 0, 0, null)).isEmpty();
    }

    @Test
    void liquidationsScaleWithTheMarketAndNameTheDominantSide() {
        // $1.18B daily volume: the bar is max($500k, 0.05% of volume) = $590k
        assertThat(evaluate(row(0, 1, 0, 0.01), 400_000, 150_000, null)).isEmpty();
        assertThat(evaluate(row(0, 1, 0, 0.01), 500_000, 150_000, null))
                .singleElement().extracting(Signal::title).isEqualTo("$650.0K of WIF longs liquidated in five minutes");
    }

    @Test
    void onlyEstablishedWallsCloseToThePriceCount() {
        Wall fresh = new Wall("WIFUSDT", BookSide.BID, 0.8400, 2_100_000, -0.25, 22, 30, 4.0);
        Wall established = new Wall("WIFUSDT", BookSide.BID, 0.8400, 2_100_000, -0.25, 22, 600, 4.0);
        Wall far = new Wall("WIFUSDT", BookSide.BID, 0.8300, 2_100_000, -1.4, 22, 600, 4.0);

        assertThat(evaluate(row(0, 1, 0, 0.01), 0, 0, fresh)).isEmpty();
        assertThat(evaluate(row(0, 1, 0, 0.01), 0, 0, far)).isEmpty();
        assertThat(evaluate(row(0, 1, 0, 0.01), 0, 0, established))
                .singleElement().extracting(Signal::title).isEqualTo("WIF trades 0.25% above a $2.1M bid wall");
    }

    private static List<Signal> evaluate(SymbolMetrics m, double longs, double shorts, Wall wall) {
        return SignalRules.evaluate(m, longs, shorts, wall, MIN_VOLUME, 1_000);
    }

    private static SymbolMetrics row(double ch5m, double surge, double oiCh15m, double funding) {
        return new SymbolMetrics("WIFUSDT", 0.8421, 0.1, ch5m, 1.0, 2.0, 9.62, 0.86, 0.77,
                1_180_000_000, surge, 1.4, funding, null, 412_000_000.0, oiCh15m, 0);
    }
}
