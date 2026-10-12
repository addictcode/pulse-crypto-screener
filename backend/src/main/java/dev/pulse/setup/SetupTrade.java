package dev.pulse.setup;

import java.time.Instant;

/**
 * One setup as the journal knows it, open or finished.
 *
 * @param resultR what it made in R, the distance to the stop, after fees; null while open
 */
public record SetupTrade(
        long id,
        String symbol,
        String timeframe,
        int direction,
        double entry,
        double stop,
        double target,
        Instant openedAt,
        Instant expiresAt,
        SetupStatus status,
        Instant closedAt,
        Double exitPrice,
        Double resultR) {

    public SetupPlan plan() {
        return new SetupPlan(direction, entry, stop, target);
    }
}
