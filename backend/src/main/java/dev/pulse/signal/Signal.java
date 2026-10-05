package dev.pulse.signal;

/**
 * A fired signal.
 *
 * @param id    database id, {@code null} until stored
 * @param value the measurement that triggered it, in the type's unit (percent, multiple, USD)
 * @param title one line a human reads first: "WIF jumps 2.8% in five minutes"
 */
public record Signal(Long id, SignalType type, String symbol, long time, double price, double value, String title, String detail) {

    public Signal withId(long newId) {
        return new Signal(newId, type, symbol, time, price, value, title, detail);
    }
}
