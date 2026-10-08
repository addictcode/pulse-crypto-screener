package dev.pulse.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.account.AccountService;
import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarketStore;

@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class AlertWatcherIT {

    @Autowired
    private AlertService alerts;
    @Autowired
    private AccountService accounts;
    @Autowired
    private MarketStore market;

    private final List<Object> published = new ArrayList<>();
    private AlertWatcher watcher;
    private long userId;

    @BeforeEach
    void setUp() {
        market.onInstruments(List.of(new Instrument("ALRTUSDT", "ALRT", "USDT")));
        price(2.0);
        watcher = new AlertWatcher(alerts, market, published::add);
        userId = accounts.telegramUser(ThreadLocalRandom.current().nextLong(1, Long.MAX_VALUE)).getId();
    }

    @Test
    void firesOnceWhenThePriceGetsThere() {
        PriceAlert up = alerts.create(userId, "ALRTUSDT", 2.5, 2.0);
        PriceAlert down = alerts.create(userId, "ALRTUSDT", 1.5, 2.0);
        assertThat(up.above()).isTrue();
        assertThat(down.above()).isFalse();

        watcher.check();
        assertThat(published).isEmpty();

        price(2.6);
        watcher.check();
        watcher.check();

        assertThat(published).containsExactly(new AlertFired(up, 2.6));
        assertThat(alerts.waitingFor(userId)).containsExactly(down);
    }

    @Test
    void refusesAlertsThatMakeNoSense() {
        alerts.create(userId, "ALRTUSDT", 3.0, 2.0);

        assertThatThrownBy(() -> alerts.create(userId, "ALRTUSDT", 3.0, 2.0)).hasMessageContaining("already an alert");
        assertThatThrownBy(() -> alerts.create(userId, "ALRTUSDT", 2.0, 2.0)).hasMessageContaining("current price");
        assertThatThrownBy(() -> alerts.create(userId, "ALRTUSDT", -1, 2.0)).hasMessageContaining("positive");
    }

    @Test
    void oneUserCannotRemoveAnothersAlert() {
        PriceAlert mine = alerts.create(userId, "ALRTUSDT", 4.0, 2.0);
        long stranger = accounts.telegramUser(ThreadLocalRandom.current().nextLong(1, Long.MAX_VALUE)).getId();

        assertThat(alerts.remove(stranger, mine.id())).isFalse();
        assertThat(alerts.remove(userId, mine.id())).isTrue();
        assertThat(alerts.waiting()).doesNotContain(mine);
    }

    private void price(double value) {
        market.onCandle("ALRTUSDT", new Candle(System.currentTimeMillis(), value, value, value, value, 1, false));
    }
}
