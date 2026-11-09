package dev.pulse.status;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import dev.pulse.depth.OrderBookStore;
import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.exchange.ExchangeStatus;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalHistory;

/**
 * {@code GET /api/status/full}: what /status/ shows. The exchange feeds, how old their data is, the
 * order books, the last signal and the last day minute by minute. Nothing about visitors.
 */
@RestController
public class StatusController {

    /**
     * @param now       the server's clock, so the page measures ages without trusting the visitor's
     * @param feedAge   milliseconds since the newest exchange frame; null before the first
     * @param stale     the data is older than {@link FeedAge#STALE_MS}, or there is none
     * @param since     when the minutes below began: the last restart
     */
    public record Status(long now, Long feedAge, boolean stale, List<ExchangeStatus> exchanges, int booksSynced, int books,
                         Signal lastSignal, long since, List<StatusHistory.Minute> minutes) {
    }

    private final FeedAge feed;
    private final List<ExchangeAdapter> exchanges;
    private final OrderBookStore orderBooks;
    private final SignalHistory signals;
    private final StatusHistory history;
    private final UptimeLog uptime;

    /** @param share of the period Pulse was running, 0–1 */
    public record Downtime(long from, long to, double share, List<UptimeLog.Interval> down) {
    }

    public StatusController(FeedAge feed, List<ExchangeAdapter> exchanges, OrderBookStore orderBooks, SignalHistory signals,
                            StatusHistory history, UptimeLog uptime) {
        this.feed = feed;
        this.exchanges = exchanges;
        this.orderBooks = orderBooks;
        this.signals = signals;
        this.history = history;
        this.uptime = uptime;
    }

    /** When Pulse was not running in the last {@code days} days: /record/ says so instead of a quiet week. */
    @GetMapping("/api/status/downtime")
    public Downtime downtime(@RequestParam(defaultValue = "7") @Min(1) @Max(90) int days) {
        Instant to = Instant.now();
        Instant from = to.minus(Duration.ofDays(days));
        List<UptimeLog.Interval> down = uptime.down(from, to);
        long gone = down.stream().mapToLong(i -> Duration.between(i.from(), i.to()).toMillis()).sum();
        return new Downtime(from.toEpochMilli(), to.toEpochMilli(), 1 - gone / (double) Duration.between(from, to).toMillis(), down);
    }

    /** @param history false for the minute-by-minute day too: the terminal only asks how old the data is */
    @GetMapping("/api/status/full")
    public Status status(@RequestParam(defaultValue = "true") boolean history) {
        long now = System.currentTimeMillis();
        Long age = feed.at(now);
        List<Signal> last = signals.recent(1);
        return new Status(now, age, age == null || age > FeedAge.STALE_MS,
                exchanges.stream().map(ExchangeAdapter::status).toList(),
                (int) orderBooks.syncedCount(), orderBooks.tracked().size(),
                last.isEmpty() ? null : last.getFirst(), this.history.startedAt(), history ? this.history.minutes() : List.of());
    }
}
