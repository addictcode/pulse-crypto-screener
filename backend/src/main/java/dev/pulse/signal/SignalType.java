package dev.pulse.signal;

import java.time.Duration;
import java.util.Arrays;
import java.util.Optional;

/**
 * Everything the detector can fire. {@code floor} is the system threshold: the detector never
 * fires below it, and users can only raise it for themselves (for walls, where a smaller distance
 * is stricter, they can only lower it).
 */
public enum SignalType {

    PUMP("pump", "Pump", 2.0, "%", Duration.ofMinutes(10), true,
            "price up at least this much in 5 minutes"),
    DUMP("dump", "Dump", 2.0, "%", Duration.ofMinutes(10), true,
            "price down at least this much in 5 minutes"),
    VOLUME("volume", "Volume", 4.0, "×", Duration.ofMinutes(30), true,
            "last 5 minutes traded this many times the hourly pace"),
    OPEN_INTEREST("oi", "Open interest", 4.0, "%", Duration.ofMinutes(30), true,
            "open interest moved this much in 15 minutes"),
    FUNDING("funding", "Funding", 0.1, "%", Duration.ofHours(4), true,
            "funding rate at least this far from zero"),
    LIQUIDATIONS("liq", "Liquidations", 500_000, "$", Duration.ofMinutes(15), true,
            "liquidated in 5 minutes, at least this much"),
    WALL("wall", "Near wall", 0.3, "%", Duration.ofMinutes(30), false,
            "price within this distance of an established wall");

    private final String key;
    private final String label;
    private final double floor;
    private final String unit;
    private final Duration cooldown;
    private final boolean higherIsStronger;
    private final String description;

    SignalType(String key, String label, double floor, String unit, Duration cooldown, boolean higherIsStronger, String description) {
        this.key = key;
        this.label = label;
        this.floor = floor;
        this.unit = unit;
        this.cooldown = cooldown;
        this.higherIsStronger = higherIsStronger;
        this.description = description;
    }

    public String key() {
        return key;
    }

    public String label() {
        return label;
    }

    public double floor() {
        return floor;
    }

    public String unit() {
        return unit;
    }

    public Duration cooldown() {
        return cooldown;
    }

    /**
     * Funding extremes and walls are conditions that can hold for hours, unlike a pump or a
     * liquidation burst. One that is already true when the detector starts is not news.
     */
    public boolean isState() {
        return this == FUNDING || this == WALL;
    }

    /** False for types where a smaller value is stronger (distance to a wall). */
    public boolean higherIsStronger() {
        return higherIsStronger;
    }

    public String description() {
        return description;
    }

    /** True when {@code value} is at least as strong as {@code threshold} for this type. */
    public boolean meets(double value, double threshold) {
        return higherIsStronger ? value >= threshold : value <= threshold;
    }

    /** Inside the cooldown a repeat fires only if it is clearly stronger than the last one. */
    public boolean escalates(double value, double previous, double factor) {
        return higherIsStronger ? value >= previous * factor : value <= previous / factor;
    }

    /** A user threshold may only be stricter than the system one. */
    public boolean isAllowedThreshold(double threshold) {
        return higherIsStronger ? threshold >= floor : threshold > 0 && threshold <= floor;
    }

    /** What a signal of this type pointing this way is called in statistics: "Shorts liquidated". */
    public String label(int direction) {
        boolean up = direction > 0;
        if (direction == 0) {
            return label;
        }
        return switch (this) {
            case PUMP, DUMP -> label;
            case VOLUME -> up ? "Volume, price up" : "Volume, price down";
            case OPEN_INTEREST -> up ? "OI climbs" : "OI drops";
            case FUNDING -> up ? "Funding positive" : "Funding negative";
            case LIQUIDATIONS -> up ? "Shorts liquidated" : "Longs liquidated";
            case WALL -> up ? "Near bid wall" : "Near ask wall";
        };
    }

    public static Optional<SignalType> fromKey(String key) {
        return Arrays.stream(values()).filter(t -> t.key.equalsIgnoreCase(key)).findFirst();
    }
}
