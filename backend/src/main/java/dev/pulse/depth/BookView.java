package dev.pulse.depth;

/**
 * Read-only copy of the part of a book that matters for wall detection.
 * Bids are ordered from the best price down, asks from the best price up.
 *
 * @param coveragePct how far from the mid the snapshot reached on the thinner side; beyond it
 *                    the book only knows levels that changed since we started listening
 */
public record BookView(
        String symbol,
        double bestBid,
        double bestAsk,
        double[] bidPrices,
        double[] bidQuantities,
        double[] askPrices,
        double[] askQuantities,
        double coveragePct) {

    public double mid() {
        return (bestBid + bestAsk) / 2;
    }
}
