package dev.pulse.signal;

/** Raw aggregate straight from the query; {@link OutcomeStats} is the shape the API serves. */
record OutcomeRow(SignalType type, Integer direction,
                  Long n5m, Double avg5m, Long up5m,
                  Long n15m, Double avg15m, Long up15m,
                  Long n1h, Double avg1h, Long up1h) {

    OutcomeStats toStats() {
        return new OutcomeStats(type, direction, type.label(direction), java.util.List.of(
                OutcomeStats.Cell.of(Horizon.M5, n5m, avg5m, up5m),
                OutcomeStats.Cell.of(Horizon.M15, n15m, avg15m, up15m),
                OutcomeStats.Cell.of(Horizon.H1, n1h, avg1h, up1h)));
    }
}
