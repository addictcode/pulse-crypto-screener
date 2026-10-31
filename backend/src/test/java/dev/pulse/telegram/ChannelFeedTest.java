package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;

import org.junit.jupiter.api.Test;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;

class ChannelFeedTest {

    private static final long MINUTE = 60_000;

    private final ChannelFeed feed = new ChannelFeed(Duration.ofMinutes(5), 2, 2);

    @Test
    void onlyClearlyStrongSignalsAreTaken() {
        assertThat(feed.offer(pump(0, 3.0))).as("1.5 times the floor").isFalse();
        assertThat(feed.offer(pump(0, 4.0))).as("twice the floor").isTrue();
    }

    @Test
    void forWallsCloserIsStronger() {
        assertThat(ChannelFeed.strong(SignalType.WALL, 0.25, 2)).isFalse();
        assertThat(ChannelFeed.strong(SignalType.WALL, 0.1, 2)).isTrue();
    }

    @Test
    void aSignalWaitsOutTheDelay() {
        feed.offer(pump(0, 5));

        assertThat(feed.takeDue(4 * MINUTE)).isEmpty();
        assertThat(feed.takeDue(5 * MINUTE)).hasSize(1);
        assertThat(feed.takeDue(6 * MINUTE)).as("posted once").isEmpty();
    }

    @Test
    void signalsDueTogetherMakeOnePost() {
        feed.offer(pump(0, 5));
        feed.offer(pump(10_000, 6));

        assertThat(feed.takeDue(6 * MINUTE)).hasSize(2);
    }

    @Test
    void theHourlyBudgetDropsWhatDoesNotFit() {
        feed.offer(pump(0, 5));
        feed.takeDue(5 * MINUTE);
        feed.offer(pump(MINUTE, 5));
        feed.takeDue(6 * MINUTE);
        feed.offer(pump(2 * MINUTE, 5));

        assertThat(feed.takeDue(7 * MINUTE)).as("third post in the hour").isEmpty();
        assertThat(feed.takeDue(70 * MINUTE)).as("dropped, not saved for later").isEmpty();

        feed.offer(pump(70 * MINUTE, 5));
        assertThat(feed.takeDue(75 * MINUTE)).as("a new hour has room").hasSize(1);
    }

    private static Signal pump(long time, double value) {
        return new Signal(null, SignalType.PUMP, "WIFUSDT", time, 0.84, value, "WIF jumps", "Price 0.84.");
    }
}
