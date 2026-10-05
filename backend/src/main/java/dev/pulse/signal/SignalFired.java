package dev.pulse.signal;

/**
 * Published after a signal is stored. Listeners (web stream, Telegram) must not block:
 * they hand the signal to their own queues.
 */
public record SignalFired(Signal signal) {
}
