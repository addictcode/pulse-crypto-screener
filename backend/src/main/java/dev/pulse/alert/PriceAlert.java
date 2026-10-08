package dev.pulse.alert;

/**
 * A price level a user asked to be told about.
 *
 * @param above fixed when the alert is set: a level over the price then fires on the way up,
 *              one under it on the way down
 */
public record PriceAlert(long id, long userId, String symbol, double level, boolean above) {

    /** True once the price has reached the level from the side the alert was set on. */
    public boolean crossedAt(double price) {
        return price > 0 && (above ? price >= level : price <= level);
    }
}
