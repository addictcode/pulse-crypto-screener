package dev.pulse.depth;

/**
 * Full order book at {@code lastUpdateId}, as far as the exchange lets us see it
 * (Binance futures returns at most 1000 levels per side).
 */
public record DepthSnapshot(
        String symbol,
        long lastUpdateId,
        double[] bidPrices,
        double[] bidQuantities,
        double[] askPrices,
        double[] askQuantities) {
}
