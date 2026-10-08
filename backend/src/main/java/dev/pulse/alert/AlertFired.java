package dev.pulse.alert;

/** Published once per alert, after it is marked as fired. Listeners must not block. */
public record AlertFired(PriceAlert alert, double price) {
}
