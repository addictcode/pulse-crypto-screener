package dev.pulse.signal;

/**
 * A fired signal.
 *
 * @param id        database id, {@code null} until stored
 * @param value     the measurement that triggered it, in the type's unit (percent, multiple, USD)
 * @param title     one line a human reads first: "WIF jumps 2.8% in five minutes"
 * @param direction which way the event points: +1 up, -1 down, 0 unknown. A pump, rising open
 *                  interest, positive funding, liquidated shorts and a bid wall are all +1
 * @param ret5m     price change in percent 5 minutes after the signal; {@code null} until measured
 */
public record Signal(Long id, SignalType type, String symbol, long time, double price, double value, String title, String detail,
                     int direction, Double ret5m, Double ret15m, Double ret1h) {

    /** A signal that has just fired: no outcome yet. */
    public Signal(Long id, SignalType type, String symbol, long time, double price, double value, String title, String detail) {
        this(id, type, symbol, time, price, value, title, detail, 0, null, null, null);
    }

    public Signal withId(long newId) {
        return new Signal(newId, type, symbol, time, price, value, title, detail, direction, ret5m, ret15m, ret1h);
    }

    public Signal withDirection(int newDirection) {
        return new Signal(id, type, symbol, time, price, value, title, detail, newDirection, ret5m, ret15m, ret1h);
    }

    public Double outcome(Horizon horizon) {
        return switch (horizon) {
            case M5 -> ret5m;
            case M15 -> ret15m;
            case H1 -> ret1h;
        };
    }
}
