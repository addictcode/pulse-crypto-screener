package dev.pulse.setup;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.config.PulseProperties;
import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.market.Candle;
import dev.pulse.market.MarketStore;
import dev.pulse.market.Positioning;
import lombok.extern.slf4j.Slf4j;

/**
 * Looks for Pulse Setups across the most traded pairs, once per closed candle of each watched
 * timeframe, and writes the ones it finds into the journal. It only ever judges a candle that
 * has closed: a setup that appears and vanishes inside a candle is not a setup.
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "pulse.setups", name = "enabled", havingValue = "true")
public class SetupScanner {

    /** The exchange needs a moment after the close before its statistics include the candle. */
    static final Duration SETTLE = Duration.ofSeconds(25);
    private static final Map<String, Long> STEP_SECONDS = Map.of("5m", 300L, "15m", 900L, "1h", 3_600L, "4h", 14_400L);

    private final PulseProperties.Setups config;
    private final ExchangeAdapter exchange;
    private final MarketStore market;
    private final SetupJournal journal;
    private final ApplicationEventPublisher events;
    /** Open time, in seconds, of the last candle already judged, per timeframe. */
    private final Map<String, Long> judged = new HashMap<>();

    public SetupScanner(PulseProperties properties, ExchangeAdapter exchange, MarketStore market, SetupJournal journal,
                        ApplicationEventPublisher events) {
        this.config = properties.setups();
        this.exchange = exchange;
        this.market = market;
        this.journal = journal;
        this.events = events;
    }

    @Scheduled(fixedDelay = 20_000, initialDelay = 90_000)
    void scan() {
        scan(Instant.now());
    }

    void scan(Instant now) {
        for (String timeframe : config.timeframes()) {
            Long step = STEP_SECONDS.get(timeframe);
            if (step == null) {
                continue;
            }
            // the candle that closed most recently, once the exchange has had time to settle it
            long closed = (now.minus(SETTLE).getEpochSecond() / step - 1) * step;
            Long before = judged.put(timeframe, closed);
            if (before == null || before == closed) {
                continue; // the first pass only notes where we are: no trades from a candle we did not watch close
            }
            int found = 0;
            for (String symbol : market.topByVolume(config.pairs())) {
                if (!journal.holds(symbol, timeframe) && judge(symbol, timeframe, step, closed, now)) {
                    found++;
                }
            }
            log.info("Setups: {} candle of {} judged, {} opened", timeframe, Instant.ofEpochSecond(closed), found);
        }
    }

    private boolean judge(String symbol, String timeframe, long step, long closedBar, Instant now) {
        try {
            List<Candle> bars = exchange.candles(symbol, timeframe, SetupRules.LOOKBACK + 1).stream()
                    .filter(c -> c.openTime() / 1000 <= closedBar)
                    .toList();
            if (bars.isEmpty() || bars.getLast().openTime() / 1000 != closedBar) {
                return false; // the candle is missing: better no trade than one judged on the wrong bar
            }
            List<Positioning.Point> openInterest = exchange.openInterest(symbol, timeframe, SetupRules.OI_BARS + 8);
            Optional<SetupPlan> plan = SetupRules.planFor(bars, openInterest, step);
            Double price = market.price(symbol);
            if (plan.isEmpty() || price == null || missed(plan.get(), price)) {
                return false;
            }
            Instant expires = Instant.ofEpochSecond(closedBar + step).plusSeconds(step * SetupRules.MAX_BARS);
            events.publishEvent(new SetupOpened(journal.open(symbol, timeframe, plan.get(), now, expires)));
            return true;
        } catch (RuntimeException e) {
            log.warn("Setups: {} {} could not be judged: {}", symbol, timeframe, e.getMessage());
            return false;
        }
    }

    /** By the time the candle was judged the price had already run to the stop or the target. */
    static boolean missed(SetupPlan plan, double price) {
        return plan.direction() == 1
                ? price <= plan.stop() || price >= plan.target()
                : price >= plan.stop() || price <= plan.target();
    }
}
