package dev.pulse.depth;

/**
 * A wall as the UI sees it.
 *
 * @param size       resting value in USD
 * @param distance   signed distance from the mid in percent: negative below the price (bids)
 * @param multiple   size relative to the typical bucket of this book
 * @param age        seconds since the wall was first seen
 * @param eatMinutes how long the market would need to trade through it at the current pace;
 *                   {@code null} while there is no volume history
 */
public record Wall(
        String symbol,
        BookSide side,
        double price,
        double size,
        double distance,
        double multiple,
        long age,
        Double eatMinutes) {
}
