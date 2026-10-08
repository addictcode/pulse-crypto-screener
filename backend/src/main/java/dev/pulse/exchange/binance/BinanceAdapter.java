package dev.pulse.exchange.binance;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.config.PulseProperties;
import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.exchange.ExchangeStatus;
import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarketSink;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * Binance USDT-M futures. Startup order matters: streams open before the candle history
 * loads, so nothing that happens during the (rate limited) bootstrap is lost; the store
 * merges both sources.
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "pulse.binance", name = "enabled", havingValue = "true", matchIfMissing = true)
public class BinanceAdapter implements ExchangeAdapter {

    /** Five 5-minute points: always at least one 15 minutes old. */
    private static final int OPEN_INTEREST_HISTORY_POINTS = 5;
    private static final List<String> MARKET_WIDE_STREAMS = List.of("!ticker@arr", "!markPrice@arr@1s", "!forceOrder@arr");

    private final PulseProperties.Binance config;
    private final MarketSink sink;
    private final BinanceParser parser;
    private final BinanceRestClient rest;
    private final HttpClient http = HttpClient.newHttpClient();
    private final List<BinanceStreamConnection> connections = new CopyOnWriteArrayList<>();
    private final ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();
    private final AtomicInteger historyLoaded = new AtomicInteger();

    private volatile List<Instrument> instruments = List.of();
    private volatile Map<String, Integer> fundingHours = Map.of();

    private final ApplicationEventPublisher events;

    BinanceAdapter(PulseProperties properties, MarketSink sink, BinanceParser parser, BinanceRestClient rest,
                   ApplicationEventPublisher events) {
        this.config = properties.binance();
        this.sink = sink;
        this.parser = parser;
        this.rest = rest;
        this.events = events;
    }

    @Override
    public String name() {
        return "binance";
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        workers.submit(this::bootstrap);
    }

    private void bootstrap() {
        try {
            instruments = rest.instruments();
            sink.onInstruments(instruments);
            log.info("Binance: {} USDT perpetuals", instruments.size());

            rest.tickers().forEach(sink::onTicker);
            rest.premiumIndex().forEach(sink::onMarkPrice);
            openStreams();
            refreshFundingIntervals();
            loadHistory();
            loadOpenInterestHistory();
            pollOpenInterest();
            // the depth feed waits for this: its snapshots are expensive and should not compete with history
            events.publishEvent(new BinanceBootstrapped());
        } catch (RuntimeException e) {
            log.error("Binance bootstrap failed, retrying in 30 s", e);
            sleep(Duration.ofSeconds(30));
            workers.submit(this::bootstrap);
        }
    }

    private void openStreams() {
        List<String> streams = new ArrayList<>(MARKET_WIDE_STREAMS);
        instruments.forEach(i -> streams.add(i.symbol().toLowerCase() + "@kline_1m"));
        URI uri = URI.create(config.streamUrl());
        int perConnection = config.maxStreamsPerConnection();
        for (int from = 0, n = 0; from < streams.size(); from += perConnection, n++) {
            List<String> shard = streams.subList(from, Math.min(streams.size(), from + perConnection));
            BinanceStreamConnection connection = new BinanceStreamConnection("binance-" + n, http, uri, shard,
                    frame -> parser.dispatch(frame, sink));
            connections.add(connection);
            connection.start();
        }
    }

    private void loadHistory() {
        long started = System.currentTimeMillis();
        List<Future<?>> pending = new ArrayList<>();
        for (Instrument instrument : instruments) {
            pending.add(workers.submit(() -> {
                try {
                    sink.onCandleHistory(instrument.symbol(), rest.historyKlines(instrument.symbol(), config.klineHistory()));
                    historyLoaded.incrementAndGet();
                } catch (RuntimeException e) {
                    log.warn("Binance: klines for {} failed: {}", instrument.symbol(), e.getMessage());
                }
            }));
        }
        awaitAll(pending);
        log.info("Binance: candle history for {} symbols in {} s", historyLoaded.get(), (System.currentTimeMillis() - started) / 1000);
    }

    private static void awaitAll(List<Future<?>> pending) {
        for (Future<?> future : pending) {
            try {
                future.get();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (ExecutionException e) {
                // already logged inside the task
            }
        }
    }

    /**
     * Seeds each symbol with the last ~20 minutes of 5-minute open interest. Without it the
     * "OI 15m" column and the open interest signal stay empty for the first quarter of an hour.
     */
    private void loadOpenInterestHistory() {
        List<Future<?>> pending = new ArrayList<>();
        for (Instrument instrument : instruments) {
            pending.add(workers.submit(() -> {
                try {
                    rest.openInterestHistory(instrument.symbol(), OPEN_INTEREST_HISTORY_POINTS)
                            .forEach(p -> sink.onOpenInterest(instrument.symbol(), p.contracts(), p.time()));
                } catch (RuntimeException e) {
                    log.debug("Binance: open interest history for {} failed: {}", instrument.symbol(), e.getMessage());
                }
            }));
        }
        awaitAll(pending);
        log.info("Binance: open interest history loaded");
    }

    /**
     * Open interest has no market-wide stream, so it is polled. The rate limiter spreads
     * the requests; a full pass over ~500 symbols takes well under the poll interval.
     */
    @Scheduled(fixedDelayString = "${pulse.binance.open-interest-poll}", initialDelayString = "${pulse.binance.open-interest-poll}")
    void pollOpenInterest() {
        long now = System.currentTimeMillis();
        for (Instrument instrument : instruments) {
            workers.submit(() -> {
                try {
                    sink.onOpenInterest(instrument.symbol(), rest.openInterest(instrument.symbol()), now);
                } catch (RuntimeException e) {
                    log.debug("Binance: open interest for {} failed: {}", instrument.symbol(), e.getMessage());
                }
            });
        }
    }

    /** Binance moves contracts between 8, 4 and 1 hour funding now and then. */
    @Scheduled(fixedDelay = 3_600_000, initialDelay = 3_600_000)
    void refreshFundingIntervals() {
        try {
            fundingHours = rest.fundingIntervals();
        } catch (RuntimeException e) {
            log.warn("Binance: funding intervals failed, keeping the previous ones: {}", e.getMessage());
        }
    }

    @Override
    public int fundingIntervalHours(String symbol) {
        return fundingHours.getOrDefault(symbol, 8);
    }

    @Scheduled(fixedDelay = 10_000)
    void watchdog() {
        connections.forEach(c -> c.restartIfStale(config.staleAfter()));
    }

    @Override
    public List<Candle> candles(String symbol, String interval, int limit) {
        return rest.chartKlines(symbol, interval, limit);
    }

    @Override
    public ExchangeStatus status() {
        Long lastFrame = connections.stream().mapToLong(BinanceStreamConnection::lastFrameAt).filter(t -> t > 0).boxed()
                .max(Long::compare).orElse(null);
        int open = (int) connections.stream().filter(BinanceStreamConnection::isOpen).count();
        return new ExchangeStatus(name(), instruments.size(), historyLoaded.get(), connections.size(), open, lastFrame);
    }

    @PreDestroy
    void stop() {
        connections.forEach(BinanceStreamConnection::stop);
        workers.shutdownNow();
    }

    private static void sleep(Duration duration) {
        try {
            Thread.sleep(duration);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
