package dev.pulse.telegram;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import dev.pulse.account.AccountService;
import dev.pulse.account.DeliverySettings;
import dev.pulse.alert.AlertFired;
import dev.pulse.alert.AlertService;
import dev.pulse.config.PulseProperties;
import dev.pulse.depth.DensityScanner;
import dev.pulse.depth.OrderBookStore;
import dev.pulse.market.MarketStore;
import dev.pulse.setup.SetupClosed;
import dev.pulse.setup.SetupOpened;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalFired;
import dev.pulse.signal.SignalHistory;
import dev.pulse.visit.FunnelStep;
import dev.pulse.visit.VisitLog;
import dev.pulse.visit.VisitSource;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * The Telegram bot, and the public channel it posts to.
 * <p>
 * Closed (the default), it answers only its owner. Open, anyone can /start it and gets signals
 * with their own settings; /stop or blocking the bot ends that. The owner alone also gets Pulse
 * Setups. Until an owner chat id is configured, a closed bot tells whoever writes to it their own
 * chat id (and nothing else), which is how the owner finds theirs.
 * <p>
 * The channel, when configured, is the free showcase: strong signals only, a few minutes late.
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "pulse.telegram", name = "enabled", havingValue = "true")
class TelegramBot {

    /** Commands one chat may send a minute before the bot stops answering it for a while. */
    static final int COMMANDS_PER_MINUTE = 20;
    private static final long CHANNEL_TICK_MS = 15_000;

    private final PulseProperties.Telegram config;
    private final AccountService accounts;
    private final MarketStore market;
    private final BotCommands commands;
    private final Set<Long> toldPrivate = ConcurrentHashMap.newKeySet();
    private final Map<Long, long[]> commandCounts = new HashMap<>();
    private final ChannelFeed channel;
    private final VisitLog visits;
    private final TelegramLinks links;

    private TelegramApi api;
    private TelegramSender sender;
    private String username = "";
    private volatile boolean running;

    TelegramBot(PulseProperties properties, AccountService accounts, SignalHistory history, MarketStore market,
                OrderBookStore books, DensityScanner density, AlertService alerts, VisitLog visits, TelegramLinks links) {
        this.config = properties.telegram();
        this.visits = visits;
        this.links = links;
        this.accounts = accounts;
        this.market = market;
        this.commands = new BotCommands(accounts, history, market, books, density, alerts);
        this.channel = config.hasChannel()
                ? new ChannelFeed(config.channelDelay(), config.channelPerHour(), config.channelStrength())
                : null;
    }

    @EventListener(ApplicationReadyEvent.class)
    void start() {
        if (config.token() == null || config.token().isBlank()) {
            log.error("Telegram: enabled but PULSE_TELEGRAM_TOKEN is empty, bot not started");
            return;
        }
        api = new TelegramApi(config.apiUrl(), config.token());
        sender = new TelegramSender(api, accounts::unsubscribe);
        running = true;
        if (config.ownerChatId() != null) {
            accounts.telegramUser(config.ownerChatId());
        } else if (!config.open()) {
            log.warn("Telegram: no owner chat id yet; message the bot and it will tell you yours");
        }
        try {
            api.setMyCommands(BotCommands.MENU);
            username = api.username();
            links.reported(username);
        } catch (RuntimeException e) {
            log.warn("Telegram: could not set up the bot profile: {}", api.redact(e.getMessage()));
        }
        sender.start();
        Thread.ofVirtual().name("telegram-poll").start(this::poll);
        if (channel != null) {
            Thread.ofVirtual().name("telegram-channel").start(this::postToChannel);
        }
        log.info("Telegram: bot @{} started, {}{}", username, config.open() ? "open to everyone" : "owner only",
                channel == null ? "" : ", channel " + config.channel());
    }

    /** Delivery: hand each fired signal to the sender for every recipient who wants it. */
    @EventListener
    void onSignal(SignalFired event) {
        if (!running) {
            return;
        }
        if (channel != null) {
            channel.offer(event.signal());
        }
        Instant now = Instant.now();
        for (DeliverySettings recipient : accounts.telegramRecipients()) {
            // a closed bot serves only the owner, even if other chats are still in the table
            if ((config.open() || isOwner(recipient.telegramChatId())) && recipient.wants(event.signal(), now)) {
                sender.enqueue(recipient.telegramChatId(), event.signal());
            }
        }
    }

    /** A price alert goes out at once, on its own thread: it is rare and must not wait behind a digest. */
    @EventListener
    void onAlert(AlertFired event) {
        Long chat = accounts.settings(event.alert().userId()).telegramChatId();
        if (running && chat != null && (config.open() || isOwner(chat))) {
            Thread.ofVirtual().name("telegram-alert").start(() -> reply(chat, TelegramFormat.alert(event)));
        }
    }

    @EventListener
    void onSetupOpened(SetupOpened event) {
        tellOwner("telegram-setup", TelegramFormat.setupOpened(event.trade()));
    }

    @EventListener
    void onSetupClosed(SetupClosed event) {
        tellOwner("telegram-setup", TelegramFormat.setupClosed(event.trade()));
    }

    private void tellOwner(String thread, String text) {
        Long owner = config.ownerChatId();
        if (running && owner != null) {
            Thread.ofVirtual().name(thread).start(() -> reply(owner, text));
        }
    }

    private boolean isOwner(Long chatId) {
        return chatId != null && chatId.equals(config.ownerChatId());
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
                    handle(update, System.currentTimeMillis());
                }
            } catch (RuntimeException e) {
                long backoff = Math.min(60_000, 1_000L << Math.min(failures++, 6));
                log.warn("Telegram: polling failed ({}), retrying in {} s", api.redact(e.getMessage()), backoff / 1000);
                sleep(backoff);
            }
        }
    }

    private void handle(TelegramUpdate update, long now) {
        if (update.text() == null) {
            return;
        }
        long chat = update.chatId();
        boolean owner = isOwner(chat);
        if (!owner && !config.open()) {
            if (config.ownerChatId() == null) {
                log.info("Telegram: message from chat {} (@{}) while no owner is configured", chat, update.username());
                reply(chat, "Your chat id is <code>" + chat + "</code>.\n"
                        + "Set PULSE_TELEGRAM_OWNER_CHAT_ID to it and restart Pulse to make this your bot.");
            } else if (toldPrivate.add(chat)) {
                log.info("Telegram: ignoring chat {} (@{}), not the owner", chat, update.username());
                reply(chat, "This is a private bot.");
            }
            return;
        }
        // groups and channels have negative ids; signals are personal, so only private chats
        if (chat < 0 || !owner && !allowCommand(chat, now)) {
            return;
        }
        String[] words = update.text().trim().split("\\s+");
        String command = words[0].toLowerCase(Locale.ROOT).replaceFirst("@.*$", "");
        if (owner && command.equals("/visits")) {
            reply(chat, visitReport(words.length > 1 ? words[1] : null));
            return;
        }
        switch (command) {
            case "/start" -> {
                boolean fresh = accounts.subscribe(chat);
                if (fresh) {
                    // t.me/<bot>?start=site arrives as "/start site": the last step of the funnel
                    visits.count(LocalDate.now(ZoneOffset.UTC), FunnelStep.BOT_START, VisitSource.of(words.length > 1 ? words[1] : null));
                }
                reply(chat, (fresh ? "" : "Welcome back.\n\n") + BotCommands.welcome());
            }
            case "/stop" -> {
                accounts.unsubscribe(chat);
                reply(chat, "Stopped. Your settings are kept; /start turns signals back on.");
            }
            default -> reply(chat, commands.handle(accounts.telegramUser(chat).getId(), update.text()));
        }
    }

    /** The site funnel, for the owner only: everyone else gets "unknown command" like for any typo. */
    private String visitReport(String arg) {
        int days = VisitReport.days(arg);
        return VisitReport.format(visits.since(VisitReport.from(LocalDate.now(ZoneOffset.UTC), days)), days);
    }

    /** Keeps one chat from hogging the bot: a script sending commands nonstop gets ignored. */
    boolean allowCommand(long chat, long now) {
        synchronized (commandCounts) {
            if (commandCounts.size() > 10_000) {
                commandCounts.values().removeIf(c -> now - c[0] >= 60_000);
            }
            long[] window = commandCounts.computeIfAbsent(chat, k -> new long[] {now, 0});
            if (now - window[0] >= 60_000) {
                window[0] = now;
                window[1] = 0;
            }
            return ++window[1] <= COMMANDS_PER_MINUTE;
        }
    }

    private void postToChannel() {
        long delayMinutes = channel.delayMs() / 60_000;
        long tick = Math.min(CHANNEL_TICK_MS, Math.max(200, channel.delayMs() / 4));
        while (running) {
            sleep(tick);
            List<Signal> due = channel.takeDue(System.currentTimeMillis());
            if (due.isEmpty()) {
                continue;
            }
            Map<String, Double> prices = new HashMap<>();
            due.forEach(s -> {
                Double price = market.price(s.symbol());
                if (price != null) {
                    prices.put(s.symbol(), price);
                }
            });
            try {
                api.sendMessage((Object) config.channel(), TelegramFormat.channel(due, prices, delayMinutes, username));
            } catch (RuntimeException e) {
                // most often the bot is not an admin of the channel
                log.warn("Telegram: channel post failed: {}", api.redact(e.getMessage()));
            }
        }
    }

    private void reply(long chatId, String html) {
        try {
            api.sendMessage(chatId, html);
        } catch (TelegramApi.Blocked e) {
            accounts.unsubscribe(chatId);
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
