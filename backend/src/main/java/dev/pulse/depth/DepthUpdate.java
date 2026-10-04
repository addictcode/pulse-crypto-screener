package dev.pulse.depth;

/**
 * One incremental order book event. Quantities are absolute: a level's new size, not a change;
 * zero means the level is gone. The three ids let the book prove it missed nothing:
 * {@code previousFinalUpdateId} must equal the {@code finalUpdateId} of the event before.
 */
public record DepthUpdate(
        String symbol,
        long firstUpdateId,
        long finalUpdateId,
        long previousFinalUpdateId,
        long eventTime,
        double[] bidPrices,
        double[] bidQuantities,
        double[] askPrices,
        double[] askQuantities) {
}
