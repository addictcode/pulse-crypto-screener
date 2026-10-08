package dev.pulse.exchange;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

import dev.pulse.config.PulseProperties;

/**
 * "The process is up" says little about a market feed: the application can run for hours on a
 * stream that went silent. This reports the feed itself under {@code /actuator/health}, which is
 * also what the container's health check asks.
 */
@Component("market")
public class MarketHealthIndicator implements HealthIndicator {

    private final List<ExchangeAdapter> exchanges;
    private final Duration staleAfter;

    public MarketHealthIndicator(List<ExchangeAdapter> exchanges, PulseProperties properties) {
        this.exchanges = exchanges;
        // the watchdog reconnects a stream after staleAfter; only a feed that stays silent past that is in trouble
        this.staleAfter = properties.binance().staleAfter().multipliedBy(3);
    }

    @Override
    public Health health() {
        if (exchanges.isEmpty()) {
            return Health.up().withDetail("exchanges", "none configured").build();
        }
        long now = System.currentTimeMillis();
        boolean healthy = true;
        Map<String, Object> details = new LinkedHashMap<>();
        for (ExchangeAdapter exchange : exchanges) {
            ExchangeStatus status = exchange.status();
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("symbols", status.symbols());
            detail.put("historyLoaded", status.historyLoaded());
            detail.put("connectionsOpen", status.connectionsOpen() + " of " + status.connections());
            if (status.symbols() == 0) {
                detail.put("state", "starting"); // still loading instruments: not a failure yet
            } else {
                Long age = status.lastFrameAt() == null ? null : now - status.lastFrameAt();
                detail.put("lastFrameAgeMs", age);
                boolean live = age != null && age <= staleAfter.toMillis() && status.connectionsOpen() > 0;
                detail.put("state", live ? "live" : "silent");
                healthy &= live;
            }
            details.put(status.exchange(), detail);
        }
        return (healthy ? Health.up() : Health.outOfService()).withDetails(details).build();
    }
}
