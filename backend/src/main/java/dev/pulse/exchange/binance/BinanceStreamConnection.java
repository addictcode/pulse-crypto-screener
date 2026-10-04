package dev.pulse.exchange.binance;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

import lombok.extern.slf4j.Slf4j;

/**
 * One combined-stream WebSocket with automatic resubscribe and reconnect.
 * Binance caps a connection at 1024 streams and 10 incoming messages per second,
 * so subscriptions go out in batches with a pause between them.
 */
@Slf4j
final class BinanceStreamConnection implements WebSocket.Listener {

    private static final int STREAMS_PER_SUBSCRIBE = 100;
    private static final long SUBSCRIBE_PAUSE_MS = 250;

    private final String name;
    private final HttpClient http;
    private final URI uri;
    private final List<String> streams;
    private final Consumer<String> onFrame;
    private final StringBuilder partial = new StringBuilder();
    private final AtomicBoolean reconnectScheduled = new AtomicBoolean();

    private volatile WebSocket socket;
    private volatile boolean running;
    private volatile long lastFrameAt;
    private int attempt;
    private int requestId;

    BinanceStreamConnection(String name, HttpClient http, URI uri, List<String> streams, Consumer<String> onFrame) {
        this.name = name;
        this.http = http;
        this.uri = uri;
        this.streams = List.copyOf(streams);
        this.onFrame = onFrame;
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

    /**
     * Called by the adapter's watchdog. A socket can stay open while delivering nothing,
     * which is exactly how the deprecated endpoint fails, so silence counts as a failure.
     */
    void restartIfStale(Duration staleAfter) {
        if (!running || lastFrameAt == 0) {
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
        Thread.ofVirtual().name("binance-subscribe-" + name).start(() -> subscribe(ws));
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

    private void subscribe(WebSocket ws) {
        for (int from = 0; from < streams.size(); from += STREAMS_PER_SUBSCRIBE) {
            List<String> batch = streams.subList(from, Math.min(streams.size(), from + STREAMS_PER_SUBSCRIBE));
            String params = String.join("\",\"", batch);
            String message = "{\"method\":\"SUBSCRIBE\",\"params\":[\"" + params + "\"],\"id\":" + (++requestId) + "}";
            try {
                ws.sendText(message, true).join();
                Thread.sleep(SUBSCRIBE_PAUSE_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (RuntimeException e) {
                log.warn("[{}] subscribe failed: {}", name, e.getMessage());
                return;
            }
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
