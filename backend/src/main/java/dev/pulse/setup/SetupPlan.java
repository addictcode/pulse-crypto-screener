package dev.pulse.setup;

/**
 * A trade Pulse Setups proposes: which way, from where, where it is wrong and where it is paid.
 *
 * @param direction 1 for a long, -1 for a short
 */
public record SetupPlan(int direction, double entry, double stop, double target) {

    public double risk() {
        return Math.abs(entry - stop);
    }
}
