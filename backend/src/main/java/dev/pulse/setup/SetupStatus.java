package dev.pulse.setup;

public enum SetupStatus {
    OPEN,
    /** The target was reached. */
    WON,
    /** The stop was hit. */
    LOST,
    /** Neither happened in time and the trade was closed at market. */
    TIMEOUT
}
