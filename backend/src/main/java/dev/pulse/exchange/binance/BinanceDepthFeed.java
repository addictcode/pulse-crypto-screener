package dev.pulse.exchange.binance;

import java.net.URI;
import java.net.http.HttpClient;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;

import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.config.PulseProperties;
import dev.pulse.depth.DepthUpdate;
import dev.pulse.depth.OrderBook;
import dev.pulse.depth.OrderBookStore;
import dev.pulse.market.MarketStore;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * Keeps live order books for the most traded Binance perpetuals: diff-depth streams from the
 * public endpoint plus REST snapshots whenever a book is new or has lost continuity.
 */
@Slf4j
@Component
@ConditionalOnExpression("${pulse.binance.enabled:true} and ${pulse.density.enabled:true}")
class BinanceDepthFeed {

    /** Wait this long for the first stream event before fetching a snapshot anyway. */
    private static final long FIRST_EVENT_WAIT_MS = 5_000;
    private static final long RETRY_DELAY_MS = 1_000;

    private final PulseProperties.Binance binance;
    private final PulseProperties.Density density;
    private final MarketStore market;
    private final OrderBookStore books;
    private final BinanceRestClient rest;
    private final BinanceParser parser;
    private final HttpClient http = HttpClient.newHttpClient();
    private final BlockingQueue<String> snapshotQueue = new LinkedBlockingQueue<>();
    private final Map<String, Long> queuedAt = new ConcurrentHashMap<>();
    private final Set<String> waitingForEvents = ConcurrentHashMap.newKeySet();

    private volatile BinanceStreamConnection connection;
    private volatile boolean running;

    BinanceDepthFeed(PulseProperties properties, MarketStore market, OrderBookStore books, BinanceRestClient rest, BinanceParser parser) {
        this.binance = properties.binance();
        this.density = properties.density();
        this.market = market;
        this.books = books;
        this.rest = rest;
        this.parser = parser;
    }

    @EventListener(BinanceBootstrapped.class)
    void start() {
        running = true;
        connection = new BinanceStreamConnection("binance-depth", http, URI.create(binance.publicStreamUrl()), List.of(),
                this::onFrame, this::onConnected);
        reselect();
        connection.start();
        Thread.ofVirtual().name("binance-depth-snapshots").start(this::snapshotLoop);
    }

    /** The most traded symbols change slowly; re-checking every few minutes is plenty. */
    @Scheduled(fixedDelayString = "${pulse.density.reselect-interval}", initialDelayString = "${pulse.density.reselect-interval}")
    void reselect() {
        BinanceStreamConnection conn = connection;
        if (!running || conn == null) {
            return;
        }
        Set<String> wanted = new HashSet<>(market.topByVolume(density.books()));
        Set<String> current = books.tracked();

        List<String> removed = current.stream().filter(s -> !wanted.contains(s)).toList();
        List<String> added = wanted.stream().filter(s -> !current.contains(s)).toList();
        removed.forEach(books::untrack);
        added.forEach(books::track);
        conn.unsubscribe(removed.stream().map(BinanceDepthFeed::stream).toList());
        conn.subscribe(added.stream().map(BinanceDepthFeed::stream).toList());
        added.forEach(this::requestSnapshot);
        if (!added.isEmpty() || !removed.isEmpty()) {
            log.info("Depth: tracking {} books (+{} -{})", wanted.size(), added.size(), removed.size());
        }
    }

    @Scheduled(fixedDelay = 10_000)
    void watchdog() {
        BinanceStreamConnection conn = connection;
        if (conn != null) {
            conn.restartIfStale(binance.staleAfter());
        }
    }

    private void onFrame(String frame) {
        DepthUpdate update = parser.depthUpdate(frame);
        if (update == null) {
            return;
        }
        waitingForEvents.remove(update.symbol());
        if (books.onUpdate(update) == OrderBook.Status.NEEDS_SNAPSHOT) {
            log.debug("Depth: {} lost continuity, resyncing", update.symbol());
            requestSnapshot(update.symbol());
        }
    }

    /** After a reconnect events were certainly missed, so every book starts over. */
    private void onConnected() {
        books.resetAll();
        books.tracked().forEach(this::requestSnapshot);
    }

    private void requestSnapshot(String symbol) {
        if (queuedAt.putIfAbsent(symbol, System.currentTimeMillis()) == null) {
            waitingForEvents.add(symbol);
            snapshotQueue.add(symbol);
        }
    }

    /**
     * A snapshot taken before the stream delivers anything for the symbol would be stale by the
     * time events arrive, so fresh requests wait (briefly) until the book has buffered an event.
     */
    private void snapshotLoop() {
        while (running) {
            String symbol;
            try {
                symbol = snapshotQueue.take();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            Long since = queuedAt.get(symbol);
            if (!books.isTracked(symbol) || since == null) {
                queuedAt.remove(symbol);
                continue;
            }
            if (waitingForEvents.contains(symbol) && System.currentTimeMillis() - since < FIRST_EVENT_WAIT_MS) {
                snapshotQueue.add(symbol); // check again on the next pass
                pause(50);
                continue;
            }
            queuedAt.remove(symbol);
            try {
                if (!books.onSnapshot(rest.depthSnapshot(symbol))) {
                    requestSnapshot(symbol);
                }
            } catch (RuntimeException e) {
                log.warn("Depth: snapshot for {} failed: {}", symbol, e.getMessage());
                pause(RETRY_DELAY_MS);
                requestSnapshot(symbol);
            }
        }
    }

    @PreDestroy
    void stop() {
        running = false;
        BinanceStreamConnection conn = connection;
        if (conn != null) {
            conn.stop();
        }
    }

    private static String stream(String symbol) {
        return symbol.toLowerCase() + "@depth@500ms";
    }

    private static void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
