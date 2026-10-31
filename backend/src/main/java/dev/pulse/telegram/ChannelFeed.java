package dev.pulse.telegram;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;

/**
 * What the public channel gets: only clearly strong signals, a few minutes after the bot had them,
 * and no more than a few posts an hour. The delay is the point of the channel: it shows what the
 * bot catches and how the price went on, while the bot stays the place to get it first.
 */
final class ChannelFeed {

    static final long HOUR_MS = 3_600_000;

    private final long delayMs;
    private final int perHour;
    private final double strength;
    private final List<Signal> pending = new ArrayList<>();
    private final Deque<Long> posted = new ArrayDeque<>();

    ChannelFeed(Duration delay, int perHour, double strength) {
        this.delayMs = delay.toMillis();
        this.perHour = perHour;
        this.strength = strength;
    }

    /** @return true if the signal is strong enough to be shown in the channel later */
    synchronized boolean offer(Signal signal) {
        if (!strong(signal.type(), signal.value(), strength)) {
            return false;
        }
        pending.add(signal);
        return true;
    }

    /**
     * Signals whose delay is over, to go out together as one post. Empty when nothing is due, or
     * when the hour's posts are used up: then the due ones are dropped, since a stale catch-up
     * post later would only add noise.
     */
    synchronized List<Signal> takeDue(long now) {
        List<Signal> due = new ArrayList<>();
        pending.removeIf(s -> s.time() + delayMs <= now && due.add(s));
        while (!posted.isEmpty() && now - posted.peekFirst() >= HOUR_MS) {
            posted.pollFirst();
        }
        if (due.isEmpty() || posted.size() >= perHour) {
            return List.of();
        }
        posted.addLast(now);
        return due;
    }

    static boolean strong(SignalType type, double value, double strength) {
        double threshold = type.higherIsStronger() ? type.floor() * strength : type.floor() / strength;
        return type.meets(value, threshold);
    }

    long delayMs() {
        return delayMs;
    }
}
