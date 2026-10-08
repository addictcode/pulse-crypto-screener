package dev.pulse.signal;

import java.time.Duration;

/** How long after a signal its outcome is measured. */
public enum Horizon {

    M5("5m", Duration.ofMinutes(5)),
    M15("15m", Duration.ofMinutes(15)),
    H1("1h", Duration.ofHours(1));

    private final String label;
    private final Duration delay;

    Horizon(String label, Duration delay) {
        this.label = label;
        this.delay = delay;
    }

    public String label() {
        return label;
    }

    public Duration delay() {
        return delay;
    }
}
