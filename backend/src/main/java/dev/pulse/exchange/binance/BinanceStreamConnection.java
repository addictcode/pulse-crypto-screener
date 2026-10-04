package dev.pulse.exchange.binance;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;

import lombok.extern.slf4j.Slf4j;

/**
 * One combined-stream WebSocket with automatic resubscribe and reconnect.
 * The stream set can change at runtime; after a reconnect everything currently wanted is
 * subscribed again. Binance caps a connection at 1024 streams and 10 incoming messages per
 * second, so subscriptions go out in batches with a pause between them.
 */
@Slf4j
final class BinanceStreamConnection implements WebSocket.Listener {

    private static final int STREAMS_PER_MESSAGE = 100;
    private static final long MESSAGE_PAUSE_MS = 250;

    private final String name;
    private final HttpClient http;
    private final URI uri;
    private final Set<String> streams = ConcurrentHashMap.newKeySet();
    private final Consumer<String> onFrame;
    private final Runnable onConnected;
    private final StringBuilder partial = new StringBuilder();
    private final AtomicBoolean reconnectScheduled = new AtomicBoolean();
    private final AtomicInteger requestId = new AtomicInteger();
    /** WebSocket forbids a send while the previous one is still in flight. */
    private final ReentrantLock sendLock = new ReentrantLock();

    private volatile WebSocket socket;
    private volatile boolean running;
    private volatile long lastFrameAt;
    private int attempt;

    BinanceStreamConnection(String name, HttpClient http, URI uri, Collection<String> streams, Consumer<String> onFrame) {
        this(name, http, uri, streams, onFrame, () -> { });
    }

    /**
     * @param onConnected runs on every (re)connect before subscribing, e.g. to invalidate state
     *                    that depends on an unbroken event sequence
     */
    BinanceStreamConnection(String name, HttpClient http, URI uri, Collection<String> streams,
                            Consumer<String> onFrame, Runnable onConnected) {
        this.name = name;
        this.http = http;
        this.uri = uri;
        this.streams.addAll(streams);
        this.onFrame = onFrame;
        this.onConnected = onConnected;
    }

    void start() {
        running = true;
        connect();
    }

    void stop() {
        running = false;
        WebSocket ws = socket;
        if (ws != null) {
            ws.abort();
        }
    }

    boolean isOpen() {
        WebSocket ws = socket;
        return ws != null && !ws.isInputClosed();
    }

    long lastFrameAt() {
        return lastFrameAt;
    }

    void subscribe(Collection<String> added) {
        List<String> fresh = added.stream().filter(streams::add).toList();
        sendInBackground("SUBSCRIBE", fresh);
    }

    void unsubscribe(Collection<String> removed) {
        List<String> gone = removed.stream().filter(streams::remove).toList();
        sendInBackground("UNSUBSCRIBE", gone);
    }

    /**
     * Called by the owner's watchdog. A socket can stay open while delivering nothing,
     * which is exactly how the deprecated endpoint fails, so silence counts as a failure.
     */
    void restartIfStale(Duration staleAfter) {
        if (!running || lastFrameAt == 0 || streams.isEmpty()) {
            return;
        }
        long silentMs = System.currentTimeMillis() - lastFrameAt;
        if (silentMs > staleAfter.toMillis()) {
            log.warn("[{}] no data for {} ms, reconnecting", name, silentMs);
            WebSocket ws = socket;
            if (ws != null) {
                ws.abort();
            }
            scheduleReconnect();
        }
    }

    private void connect() {
        http.newWebSocketBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .buildAsync(uri, this)
                .whenComplete((ws, error) -> {
                    if (error != null) {
                        log.warn("[{}] connect failed: {}", name, error.getMessage());
                        scheduleReconnect();
                    }
                });
    }

    @Override
    public void onOpen(WebSocket ws) {
        socket = ws;
        attempt = 0;
        lastFrameAt = System.currentTimeMillis();
        partial.setLength(0);
        log.info("[{}] connected, subscribing to {} streams", name, streams.size());
        onConnected.run();
        sendInBackground("SUBSCRIBE", List.copyOf(streams));
        ws.request(1);
    }

    @Override
    public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
        partial.append(data);
        if (last) {
            String frame = partial.toString();
            partial.setLength(0);
            lastFrameAt = System.currentTimeMillis();
            try {
                onFrame.accept(frame);
            } catch (RuntimeException e) {
                log.warn("[{}] failed to handle frame: {}", name, e.getMessage());
            }
        }
        ws.request(1);
        return null;
    }

    @Override
    public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
        log.info("[{}] closed by server: {} {}", name, statusCode, reason);
        scheduleReconnect();
        return null;
    }

    @Override
    public void onError(WebSocket ws, Throwable error) {
        log.warn("[{}] error: {}", name, error.getMessage());
        scheduleReconnect();
    }

    private void sendInBackground(String method, List<String> batch) {
        WebSocket ws = socket;
        if (ws == null || batch.isEmpty()) {
            return; // not connected yet: onOpen subscribes to the whole current set
        }
        Thread.ofVirtual().name("binance-" + method.toLowerCase() + "-" + name).start(() -> send(ws, method, batch));
    }

    private void send(WebSocket ws, String method, List<String> all) {
        sendLock.lock();
        try {
            for (int from = 0; from < all.size(); from += STREAMS_PER_MESSAGE) {
                List<String> batch = new ArrayList<>(all.subList(from, Math.min(all.size(), from + STREAMS_PER_MESSAGE)));
                String message = "{\"method\":\"" + method + "\",\"params\":[\"" + String.join("\",\"", batch)
                        + "\"],\"id\":" + requestId.incrementAndGet() + "}";
                ws.sendText(message, true).join();
                Thread.sleep(MESSAGE_PAUSE_MS);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException e) {
            log.warn("[{}] {} failed: {}", name, method, e.getMessage());
        } finally {
            sendLock.unlock();
        }
    }

    private void scheduleReconnect() {
        if (!running || !reconnectScheduled.compareAndSet(false, true)) {
            return;
        }
        socket = null;
        long delay = Math.min(30, 1L << Math.min(attempt++, 5));
        log.info("[{}] reconnecting in {} s", name, delay);
        CompletableFuture.delayedExecutor(delay, TimeUnit.SECONDS).execute(() -> {
            reconnectScheduled.set(false);
            if (running) {
                connect();
            }
        });
    }
}
