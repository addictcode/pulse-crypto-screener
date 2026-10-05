package dev.pulse.signal;

/**
 * One line of the live tape.
 *
 * @param value the move in percent, the volume multiple, or the liquidated USD, depending on the kind
 */
public record TapeItem(TapeKind kind, String symbol, long time, double price, double value) {
}
