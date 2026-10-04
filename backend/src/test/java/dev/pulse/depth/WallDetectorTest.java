package dev.pulse.depth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

class WallDetectorTest {

    private static final WallDetector.Params PARAMS = new WallDetector.Params(0.05, 6, 25_000, 0.0003, 4);

    @Test
    void findsABucketManyTimesLargerThanTheTypicalOne() {
        // price ~100, levels every 0.05 (one bucket each), $10k per level, one $400k bid at 99.00
        BookView view = book(100, 99.00, 4_000);

        List<WallDetector.Detected> walls = WallDetector.detect(view, 0.05, 0, PARAMS);

        assertThat(walls).hasSize(1);
        WallDetector.Detected wall = walls.getFirst();
        assertThat(wall.side()).isEqualTo(BookSide.BID);
        assertThat(wall.price()).isEqualTo(99.00);
        assertThat(wall.notional()).isCloseTo(396_000, within(1.0));
        assertThat(wall.multiple()).isGreaterThan(30);
    }

    @Test
    void largeVolumeRaisesTheAbsoluteFloor() {
        BookView view = book(100, 99.00, 4_000);

        // 0.03% of $2B daily volume is $600k: the same $396k level is ordinary for this market
        assertThat(WallDetector.detect(view, 0.05, 2e9, PARAMS)).isEmpty();
    }

    @Test
    void neighbouringTicksOfOneWallAreCountedTogether() {
        double[] bidPrices = levels(99.95, -0.01, 400);
        double[] bidQty = filled(bidPrices.length, 100);
        // a ~$450k wall split over three ticks inside the same 0.05 bucket
        for (int i = 0; i < bidPrices.length; i++) {
            if (Math.abs(bidPrices[i] - 99.01) < 1e-9 || Math.abs(bidPrices[i] - 99.02) < 1e-9 || Math.abs(bidPrices[i] - 99.03) < 1e-9) {
                bidQty[i] = 1_500;
            }
        }
        double[] askPrices = levels(100.05, 0.01, 400);
        BookView view = new BookView("TEST", 99.95, 100.05, bidPrices, bidQty, askPrices, filled(askPrices.length, 100), 5);

        List<WallDetector.Detected> walls = WallDetector.detect(view, 0.05, 0, PARAMS);

        assertThat(walls).singleElement().satisfies(w -> {
            assertThat(w.notional()).isGreaterThan(440_000);
            assertThat(w.price()).as("the heaviest tick, not the bucket edge").isIn(99.01, 99.02, 99.03);
        });
    }

    @Test
    void emptyBookHasNoWalls() {
        BookView view = new BookView("TEST", 99, 101, new double[0], new double[0], new double[0], new double[0], 1);

        assertThat(WallDetector.detect(view, 0.05, 0, PARAMS)).isEmpty();
    }

    /** A book with $10k on every 0.05 step on both sides and one big bid. */
    private static BookView book(double mid, double wallPrice, double wallQuantity) {
        double[] bidPrices = levels(mid - 0.05, -0.05, 100);
        double[] bidQty = new double[bidPrices.length];
        for (int i = 0; i < bidPrices.length; i++) {
            bidQty[i] = Math.abs(bidPrices[i] - wallPrice) < 1e-9 ? wallQuantity : 10_000 / bidPrices[i];
        }
        double[] askPrices = levels(mid + 0.05, 0.05, 100);
        double[] askQty = new double[askPrices.length];
        for (int i = 0; i < askPrices.length; i++) {
            askQty[i] = 10_000 / askPrices[i];
        }
        return new BookView("TEST", bidPrices[0], askPrices[0], bidPrices, bidQty, askPrices, askQty, 5);
    }

    private static double[] levels(double start, double step, int count) {
        double[] prices = new double[count];
        for (int i = 0; i < count; i++) {
            prices[i] = Math.round((start + step * i) * 100) / 100.0;
        }
        return prices;
    }

    private static double[] filled(int count, double value) {
        double[] values = new double[count];
        Arrays.fill(values, value);
        return values;
    }
}
