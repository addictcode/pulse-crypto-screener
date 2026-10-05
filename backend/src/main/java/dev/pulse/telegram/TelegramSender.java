package dev.pulse.telegram;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

import dev.pulse.signal.Signal;
import lombok.extern.slf4j.Slf4j;

/**
 * Delivers signals at a pace Telegram accepts (about one message per second per chat).
 * When signals pile up faster than that, the backlog goes out as one digest instead of a burst.
 */
@Slf4j
final class TelegramSender {

    static final long PAUSE_MS = 1_100;
    static final int DIGEST_FROM = 3;
    static final int DIGEST_MAX = 15;

    private record Outgoing(long chatId, Signal signal) {
    }

    private final TelegramApi api;
    private final BlockingQueue<Outgoing> queue = new LinkedBlockingQueue<>();
    private volatile boolean running;

    TelegramSender(TelegramApi api) {
        this.api = api;
    }

    void start() {
        running = true;
        Thread.ofVirtual().name("telegram-sender").start(this::loop);
    }

    void stop() {
        running = false;
    }

    void enqueue(long chatId, Signal signal) {
        queue.add(new Outgoing(chatId, signal));
    }

    private void loop() {
        while (running) {
            try {
                Outgoing first = queue.take();
                List<Outgoing> batch = new ArrayList<>(List.of(first));
                queue.drainTo(batch, DIGEST_MAX - 1);
                // single-user today: everything in the batch goes to one chat, but keep it correct for more
                batch.stream().map(Outgoing::chatId).distinct().forEach(chat -> deliver(chat,
                        batch.stream().filter(o -> o.chatId() == chat).map(Outgoing::signal).toList()));
                Thread.sleep(PAUSE_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void deliver(long chatId, List<Signal> signals) {
        String text = signals.size() >= DIGEST_FROM
                ? TelegramFormat.digest(signals)
                : String.join("\n\n", signals.stream().map(TelegramFormat::signal).toList());
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                api.sendMessage(chatId, text);
                return;
            } catch (TelegramApi.RateLimited e) {
                log.warn("Telegram: {}, waiting", e.getMessage());
                sleep(e.retryAfterSeconds * 1000);
            } catch (RuntimeException e) {
                log.warn("Telegram: send failed: {}", api.redact(e.getMessage()));
                sleep(2_000);
            }
        }
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
