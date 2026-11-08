package dev.pulse.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;

class PushServiceTest {

    private static final PushProperties ON = new PushProperties("pub", "priv", "mailto:a@b.c", 4, 20, 2,
            List.of("fcm.googleapis.com", "web.push.apple.com"), 50, false);

    private static Signal pump(String symbol, double value) {
        return new Signal(1L, SignalType.PUMP, symbol, 0, 1, value, "WIF jumps", "", 1, null, null, null);
    }

    @Test
    void onlyHttpsOnAKnownPushServiceIsStored() {
        PushService push = new PushService(null, ON);
        assertThat(push.checkedEndpoint("https://fcm.googleapis.com/fcm/send/abc")).isEqualTo("https://fcm.googleapis.com/fcm/send/abc");
        assertThat(push.checkedEndpoint("https://web.push.apple.com/QH1x")).startsWith("https://web.push.apple.com/");
        for (String bad : List.of("http://fcm.googleapis.com/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/x",
                "https://127.0.0.1/x", "file:///etc/passwd", "")) {
            assertThatThrownBy(() -> push.checkedEndpoint(bad)).as(bad).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void aSubscriptionGetsItsPairsAndStrongOnesIfItAskedSo() {
        assertThat(PushService.wants(Set.of(), false, pump("WIFUSDT", 2.1), 2)).isTrue();
        assertThat(PushService.wants(Set.of(), true, pump("WIFUSDT", 2.1), 2)).as("a pump of 2.1% is not strong").isFalse();
        assertThat(PushService.wants(Set.of(), true, pump("WIFUSDT", 4.5), 2)).isTrue();
        assertThat(PushService.wants(Set.of("BTCUSDT"), false, pump("WIFUSDT", 9), 2)).as("not on its list").isFalse();
        assertThat(PushService.wants(Set.of("WIFUSDT"), true, pump("WIFUSDT", 4.5), 2)).isTrue();
    }

    @Test
    void aBrowserGetsAtMostFourAnHour() {
        PushSender sender = new PushSender(null, ON);
        for (int i = 0; i < 4; i++) {
            assertThat(sender.admit("e", i * 1_000L)).isTrue();
        }
        assertThat(sender.admit("e", 5_000)).isFalse();
        assertThat(sender.admit("other", 5_000)).isTrue();
        assertThat(sender.admit("e", 3_600_000)).as("the first one is an hour old").isTrue();
    }

    @Test
    void theNotificationSpeaksTheBrowsersLanguageAndOpensThePair() {
        assertThat(PushSender.payload(pump("WIFUSDT", 2.84), "ru"))
                .contains("\"title\":\"WIF растёт на 2,8% за 5 минут\"", "Не финансовый совет", "\"url\":\"/app/#screener:WIFUSDT\"");
        assertThat(PushSender.payload(pump("WIFUSDT", 2.84), "en")).contains("\"title\":\"WIF jumps\"", "Not financial advice");
    }

    @Test
    void oneAddressCannotFillTheTable() {
        SubscribeGate gate = new SubscribeGate();
        for (int i = 0; i < SubscribeGate.PER_DAY; i++) {
            assertThat(gate.admit("1.1.1.1", i)).isTrue();
        }
        assertThat(gate.admit("1.1.1.1", 100)).isFalse();
        assertThat(gate.admit("1.1.1.1", SubscribeGate.DAY_MS)).isTrue();
    }

    @Test
    void withoutKeysThereIsNothingToSubscribeTo() {
        PushProperties off = new PushProperties("", "", "", 0, 0, 0, null, 0, false);
        PushController controller = new PushController(new PushService(null, off), off);
        assertThat(off.enabled()).isFalse();
        assertThat(controller.key().getStatusCode().value()).isEqualTo(404);
    }
}
