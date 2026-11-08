package dev.pulse.telegram;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.function.LongConsumer;

import dev.pulse.signal.Signal;
import lombok.extern.slf4j.Slf4j;

/**
 * Delivers signals at a pace Telegram accepts: about one message per second per chat and 30 a
 * second across all chats. When signals pile up faster than that, a chat's backlog goes out as
 * one digest instead of a burst.
 */
@Slf4j
final class TelegramSender {

    static final long PAUSE_MS = 1_100;
    /** 25 messages a second overall, under Telegram's 30. */
    static final long GAP_MS = 40;
    static final int DIGEST_FROM = 3;
    static final int DIGEST_MAX = 15;
    /** One signal can go to every subscriber at once; take a whole round of them per pass. */
    static final int DRAIN_MAX = 10_000;

    private record Outgoing(long chatId, Signal signal, boolean ru) {
    }

    private final TelegramApi api;
    private final LongConsumer onBlocked;
    private final BlockingQueue<Outgoing> queue = new LinkedBlockingQueue<>();
    private volatile boolean running;

    /** @param onBlocked told the chat id of anyone who blocked the bot, to stop sending them signals */
    TelegramSender(TelegramApi api, LongConsumer onBlocked) {
        this.api = api;
        this.onBlocked = onBlocked;
    }

    void start() {
        running = true;
        Thread.ofVirtual().name("telegram-sender").start(this::loop);
    }

    void stop() {
        running = false;
    }

    void enqueue(long chatId, Signal signal) {
        enqueue(chatId, signal, false);
    }

    void enqueue(long chatId, Signal signal, boolean ru) {
        queue.add(new Outgoing(chatId, signal, ru));
    }

    private void loop() {
        while (running) {
            try {
                Outgoing first = queue.take();
                List<Outgoing> batch = new ArrayList<>(List.of(first));
                queue.drainTo(batch, DRAIN_MAX - 1);
                Map<Long, List<Signal>> byChat = new LinkedHashMap<>();
                Map<Long, Boolean> russian = new LinkedHashMap<>();
                for (Outgoing o : batch) {
                    byChat.computeIfAbsent(o.chatId(), k -> new ArrayList<>()).add(o.signal());
                    russian.put(o.chatId(), o.ru());
                }
                for (Map.Entry<Long, List<Signal>> chat : byChat.entrySet()) {
                    List<Signal> signals = chat.getValue();
                    deliver(chat.getKey(), signals.subList(Math.max(0, signals.size() - DIGEST_MAX), signals.size()), russian.get(chat.getKey()));
                    Thread.sleep(GAP_MS);
                }
                Thread.sleep(PAUSE_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void deliver(long chatId, List<Signal> signals, boolean ru) {
        String text = signals.size() >= DIGEST_FROM
                ? TelegramFormat.digest(signals, ru)
                : String.join("\n\n", signals.stream().map(s -> TelegramFormat.signal(s, ru)).toList());
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                api.sendMessage(chatId, text);
                return;
            } catch (TelegramApi.RateLimited e) {
                log.warn("Telegram: {}, waiting", e.getMessage());
                sleep(e.retryAfterSeconds * 1000);
            } catch (TelegramApi.Blocked e) {
                log.info("Telegram: chat {} blocked the bot, unsubscribing", chatId);
                onBlocked.accept(chatId);
                return;
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
