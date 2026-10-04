package dev.pulse.market;

/**
 * A forced close of a position. {@code side} is the side that got liquidated.
 */
public record Liquidation(String symbol, PositionSide side, double price, double quantity, long time) {

    public double quoteValue() {
        return price * quantity;
    }
}
