package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.account.AccountService;
import dev.pulse.account.DeliverySettings;
import dev.pulse.alert.AlertService;
import dev.pulse.market.Candle;
import dev.pulse.depth.DensityScanner;
import dev.pulse.depth.OrderBookStore;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarketStore;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalHistory;
import dev.pulse.signal.SignalType;

/**
 * Commands end to end against a real database: what the owner types changes what gets delivered.
 */
@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class BotCommandsIT {

    @Autowired
    private AccountService accounts;
    @Autowired
    private SignalHistory history;
    @Autowired
    private MarketStore market;
    @Autowired
    private OrderBookStore books;
    @Autowired
    private DensityScanner density;

    @Autowired
    private AlertService alerts;
    private BotCommands commands;
    private long userId;

    @BeforeEach
    void setUp() {
        market.onInstruments(List.of(new Instrument("WIFUSDT", "WIF", "USDT"), new Instrument("SOLUSDT", "SOL", "USDT")));
        commands = new BotCommands(accounts, history, market, books, density, alerts);
        userId = accounts.telegramUser(ThreadLocalRandom.current().nextLong(1, Long.MAX_VALUE)).getId();
    }

    @Test
    void thresholdsCanOnlyBeStricterThanTheSystemFloor() {
        assertThat(commands.handle(userId, "/threshold pump 1")).contains("cannot go lower than 2.0%");
        assertThat(commands.handle(userId, "/threshold pump 3.5")).isEqualTo("Pump threshold set to 3.5%.");
        assertThat(commands.handle(userId, "/threshold wall 0.5")).contains("cannot go higher than 0.30%");
        assertThat(settings().thresholdFor(SignalType.PUMP)).isEqualTo(3.5);
        assertThat(commands.handle(userId, "/signals")).contains("pump", "3.5%", "(custom)");

        commands.handle(userId, "/threshold pump default");
        assertThat(settings().thresholdFor(SignalType.PUMP)).isEqualTo(SignalType.PUMP.floor());
    }

    @Test
    void typesSwitchOffAndBackOn() {
        assertThat(commands.handle(userId, "/off funding")).isEqualTo("Funding signals off.");
        assertThat(settings().disabled()).containsExactly(SignalType.FUNDING);

        commands.handle(userId, "/off all");
        assertThat(settings().disabled()).hasSize(SignalType.values().length);
        commands.handle(userId, "/on all");
        assertThat(settings().disabled()).isEmpty();
        assertThat(commands.handle(userId, "/off nonsense")).startsWith("Unknown type");
    }

    @Test
    void muteAndUnmute() {
        assertThat(commands.handle(userId, "/mute 2h")).startsWith("Muted until");
        Instant until = settings().mutedUntil();
        assertThat(Duration.between(Instant.now(), until).toMinutes()).isCloseTo(120, within(1L));

        commands.handle(userId, "/mute off");
        assertThat(settings().mutedUntil()).isNull();
        assertThat(commands.handle(userId, "/mute soon")).contains("30m, 2h, 1d");
    }

    @Test
    void watchlistAcceptsLooseSymbolsAndRejectsUnknownOnes() {
        assertThat(commands.handle(userId, "/watch wif")).isEqualTo("WIF added to your watchlist.");
        assertThat(commands.handle(userId, "/watch WIF/USDT")).isEqualTo("WIF is already on your watchlist.");
        assertThat(commands.handle(userId, "/watch NOPE")).isEqualTo("NOPE is not a Binance USDT perpetual.");
        assertThat(commands.handle(userId, "/scope watchlist")).isEqualTo("Signals only for your watchlist (1 pairs).");

        DeliverySettings settings = settings();
        assertThat(settings.watchlist()).containsExactly("WIFUSDT");
        assertThat(settings.watchlistOnly()).isTrue();

        assertThat(commands.handle(userId, "/unwatch wif")).isEqualTo("WIF removed from your watchlist.");
    }

    @Test
    void lastListsRecentSignals() {
        history.record(new Signal(null, SignalType.PUMP, "WIFUSDT", System.currentTimeMillis(), 1, 2.5, "WIF jumps 2.5% in five minutes", "d"));

        assertThat(commands.handle(userId, "/last 3")).contains("Latest signals", "WIF jumps 2.5% in five minutes");
    }

    @Test
    void priceAlertsAreSetListedAndRemoved() {
        market.onCandle("WIFUSDT", new Candle(System.currentTimeMillis(), 2, 2, 2, 2, 1, false));

        assertThat(commands.handle(userId, "/alert wif 2.5")).startsWith("Alert set: WIF above 2.5000.").contains("+25.00% away");
        assertThat(commands.handle(userId, "/alert wif 1.5")).startsWith("Alert set: WIF below 1.5000.");
        assertThat(commands.handle(userId, "/alert wif 2.5")).isEqualTo("There is already an alert at that price.");
        assertThat(commands.handle(userId, "/alert wif nope")).isEqualTo("\"nope\" is not a price.");
        assertThat(commands.handle(userId, "/alert sol 10")).contains("No live price for SOL");
        assertThat(commands.handle(userId, "/alerts")).contains("WIF", "above", "below", "2.5000", "1.5000");

        long first = alerts.waitingFor(userId).getFirst().id();
        assertThat(commands.handle(userId, "/unalert " + first)).isEqualTo("Alert " + first + " removed.");
        assertThat(commands.handle(userId, "/unalert wif")).isEqualTo("1 alert on WIF removed.");
        assertThat(commands.handle(userId, "/alerts")).startsWith("No price alerts.");
    }

    @Test
    void helpAndUnknownCommands() {
        assertThat(commands.handle(userId, "/start")).contains("/threshold", "/mute");
        assertThat(commands.handle(userId, "/mute@PulseBot off")).isEqualTo("Unmuted. Signals are back on.");
        assertThat(commands.handle(userId, "hello")).startsWith("Unknown command");
    }

    private DeliverySettings settings() {
        return accounts.settings(userId);
    }
}
