package dev.pulse.telegram;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import dev.pulse.account.AccountService;
import dev.pulse.account.DeliverySettings;
import dev.pulse.config.PulseProperties;
import dev.pulse.depth.DensityScanner;
import dev.pulse.depth.OrderBookStore;
import dev.pulse.market.MarketStore;
import dev.pulse.signal.SignalFired;
import dev.pulse.signal.SignalHistory;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * Personal Telegram bot: answers commands from its owner and pushes signals to them.
 * <p>
 * Until an owner chat id is configured, the bot tells whoever writes to it their own chat id
 * (and nothing else), which is how the owner finds theirs. Everybody else is told the bot is
 * private, once.
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "pulse.telegram", name = "enabled", havingValue = "true")
class TelegramBot {

    private final PulseProperties.Telegram config;
    private final AccountService accounts;
    private final BotCommands commands;
    private final Set<Long> toldPrivate = ConcurrentHashMap.newKeySet();

    private TelegramApi api;
    private TelegramSender sender;
    private volatile boolean running;

    TelegramBot(PulseProperties properties, AccountService accounts, SignalHistory history, MarketStore market,
                OrderBookStore books, DensityScanner density) {
        this.config = properties.telegram();
        this.accounts = accounts;
        this.commands = new BotCommands(accounts, history, market, books, density);
    }

    @EventListener(ApplicationReadyEvent.class)
    void start() {
        if (config.token() == null || config.token().isBlank()) {
            log.error("Telegram: enabled but PULSE_TELEGRAM_TOKEN is empty, bot not started");
            return;
        }
        api = new TelegramApi(config.apiUrl(), config.token());
        sender = new TelegramSender(api);
        running = true;
        if (config.ownerChatId() != null) {
            accounts.telegramUser(config.ownerChatId());
        } else {
            log.warn("Telegram: no owner chat id yet; message the bot and it will tell you yours");
        }
        try {
            api.setMyCommands(BotCommands.MENU);
        } catch (RuntimeException e) {
            log.warn("Telegram: could not set the command menu: {}", api.redact(e.getMessage()));
        }
        sender.start();
        Thread.ofVirtual().name("telegram-poll").start(this::poll);
        log.info("Telegram: bot started");
    }

    /** Delivery: hand each fired signal to the sender for every recipient who wants it. */
    @EventListener
    void onSignal(SignalFired event) {
        if (!running || config.ownerChatId() == null) {
            return;
        }
        Instant now = Instant.now();
        for (DeliverySettings recipient : accounts.telegramRecipients()) {
            // single-user mode: only the configured owner, even if an old chat is still in the table
            if (config.ownerChatId().equals(recipient.telegramChatId()) && recipient.wants(event.signal(), now)) {
                sender.enqueue(recipient.telegramChatId(), event.signal());
            }
        }
    }

    private void poll() {
        long offset = 0;
        int failures = 0;
        while (running) {
            try {
                List<TelegramUpdate> updates = api.getUpdates(offset);
                failures = 0;
                for (TelegramUpdate update : updates) {
                    offset = update.updateId() + 1;
                    handle(update);
                }
            } catch (RuntimeException e) {
                long backoff = Math.min(60_000, 1_000L << Math.min(failures++, 6));
                log.warn("Telegram: polling failed ({}), retrying in {} s", api.redact(e.getMessage()), backoff / 1000);
                sleep(backoff);
            }
        }
    }

    private void handle(TelegramUpdate update) {
        if (update.text() == null) {
            return;
        }
        Long owner = config.ownerChatId();
        if (owner == null) {
            log.info("Telegram: message from chat {} (@{}) while no owner is configured", update.chatId(), update.username());
            reply(update.chatId(), "Your chat id is <code>" + update.chatId() + "</code>.\n"
                    + "Set PULSE_TELEGRAM_OWNER_CHAT_ID to it and restart Pulse to make this your bot.");
            return;
        }
        if (owner != update.chatId()) {
            if (toldPrivate.add(update.chatId())) {
                log.info("Telegram: ignoring chat {} (@{}), not the owner", update.chatId(), update.username());
                reply(update.chatId(), "This is a private bot.");
            }
            return;
        }
        long userId = accounts.telegramUser(owner).getId();
        reply(owner, commands.handle(userId, update.text()));
    }

    private void reply(long chatId, String html) {
        try {
            api.sendMessage(chatId, html);
        } catch (RuntimeException e) {
            log.warn("Telegram: reply failed: {}", api.redact(e.getMessage()));
        }
    }

    @PreDestroy
    void stop() {
        running = false;
        if (sender != null) {
            sender.stop();
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
