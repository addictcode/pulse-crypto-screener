package dev.pulse.market;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class LiquidationTallyTest {

    private static final long H = LiquidationTally.HOUR_MS;
    private static final long T0 = 1_000 * H;

    @Test
    void sumsLongsAndShortsOfTheHoursAskedFor() {
        LiquidationTally tally = new LiquidationTally(T0);
        tally.add(new Liquidation("WIFUSDT", PositionSide.LONG, 2, 1_000, T0 + 10));
        tally.add(new Liquidation("WIFUSDT", PositionSide.SHORT, 2, 500, T0 + 5 * H));
        tally.add(new Liquidation("SOLUSDT", PositionSide.LONG, 100, 10, T0 + 23 * H));

        LiquidationTally.Totals all = tally.since(T0);
        assertThat(all.longs()).isEqualTo(3_000);
        assertThat(all.shorts()).isEqualTo(1_000);
        assertThat(all.total()).isEqualTo(4_000);

        assertThat(tally.since(T0 + 5 * H).total()).isEqualTo(2_000);
    }

    @Test
    void saysWhenCountingStartedLaterThanAsked() {
        LiquidationTally tally = new LiquidationTally(T0);

        assertThat(tally.since(T0 - 24 * H).since()).isEqualTo(T0);
        assertThat(tally.since(T0 + H).since()).isEqualTo(T0 + H);
    }

    @Test
    void forgetsWhatIsOlderThanADayAndABit() {
        LiquidationTally tally = new LiquidationTally(T0);
        tally.add(new Liquidation("WIFUSDT", PositionSide.LONG, 1, 1_000, T0));
        tally.add(new Liquidation("WIFUSDT", PositionSide.LONG, 1, 1, T0 + 40 * H));

        assertThat(tally.since(T0).total()).isEqualTo(1);
    }
}
