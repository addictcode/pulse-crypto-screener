package dev.pulse.status;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.depth.OrderBookStore;

/**
 * A minute-by-minute record of the last day for /status/: how old the exchange's data was, how
 * many order books were in sync. In memory: a restart starts it afresh, and the page says since when.
 */
@Component
public class StatusHistory {

    static final int MINUTES = 24 * 60;

    /**
     * @param feedAge     milliseconds since the newest exchange frame, null when there was none
     * @param booksSynced order books in sync out of {@code books}
     */
    public record Minute(long t, Long feedAge, int booksSynced, int books) {
    }

    private final FeedAge feed;
    private final OrderBookStore orderBooks;
    private final Deque<Minute> minutes = new ArrayDeque<>();
    private final long startedAt = System.currentTimeMillis();

    public StatusHistory(FeedAge feed, OrderBookStore orderBooks) {
        this.feed = feed;
        this.orderBooks = orderBooks;
    }

    @Scheduled(fixedRate = 60_000, initialDelay = 30_000)
    void sample() {
        long now = System.currentTimeMillis();
        record(new Minute(now, feed.at(now), (int) orderBooks.syncedCount(), orderBooks.tracked().size()));
    }

    synchronized void record(Minute minute) {
        minutes.addLast(minute);
        while (minutes.size() > MINUTES) {
            minutes.pollFirst();
        }
    }

    public synchronized List<Minute> minutes() {
        return new ArrayList<>(minutes);
    }

    public long startedAt() {
        return startedAt;
    }
}
