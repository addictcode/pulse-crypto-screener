package dev.pulse.signal;

import java.util.List;

/**
 * How signals of one kind played out: for each horizon, how many were measured, the average
 * price change and how often the price ended up higher.
 */
public record OutcomeStats(SignalType type, int direction, String label, List<Cell> horizons) {

    /**
     * @param avg     average price change in percent, {@code null} with no measurements
     * @param upShare share of signals after which the price was higher, 0..1
     */
    public record Cell(String horizon, long n, Double avg, Double upShare) {

        static Cell of(Horizon horizon, Long n, Double avg, Long up) {
            long count = n == null ? 0 : n;
            return new Cell(horizon.label(), count,
                    count == 0 || avg == null ? null : Math.round(avg * 100) / 100.0,
                    count == 0 || up == null ? null : Math.round(up * 1000.0 / count) / 1000.0);
        }
    }

    /** The most measured horizon, used to sort the busiest kinds first. */
    public long measured() {
        return horizons.stream().mapToLong(Cell::n).max().orElse(0);
    }
}
