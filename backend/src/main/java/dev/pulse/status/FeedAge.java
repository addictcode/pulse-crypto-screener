package dev.pulse.status;

import java.util.List;
import java.util.Objects;

import org.springframework.stereotype.Component;

import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.exchange.ExchangeStatus;

/**
 * How old the newest frame from the exchange is, measured on the server's own clock so a visitor's
 * wrong clock cannot make live data look stale. The backend keeps broadcasting when the exchange
 * goes quiet; without this a dead feed looks like a calm market.
 */
@Component
public class FeedAge {

    /** Older than this, the pages say the data is not live. */
    public static final long STALE_MS = 30_000;

    private final List<ExchangeAdapter> exchanges;

    public FeedAge(List<ExchangeAdapter> exchanges) {
        this.exchanges = exchanges;
    }

    /** @return milliseconds since the newest frame, or null before the first one (or with no exchange) */
    public Long at(long now) {
        return exchanges.stream()
                .map(ExchangeAdapter::status)
                .filter(Objects::nonNull)
                .map(ExchangeStatus::lastFrameAt)
                .filter(Objects::nonNull)
                .max(Long::compare)
                .map(last -> Math.max(0, now - last))
                .orElse(null);
    }
}
