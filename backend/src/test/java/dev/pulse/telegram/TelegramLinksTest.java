package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;

import org.junit.jupiter.api.Test;

import dev.pulse.config.PulseProperties;

class TelegramLinksTest {

    private static TelegramLinks links(boolean enabled, String channel, String botUsername) {
        return new TelegramLinks(new PulseProperties(null, null, null, null, null, null,
                new PulseProperties.Telegram(enabled, "T", 1L, "", true, channel, Duration.ZERO, 1, 2, botUsername, null, "en"), null));
    }

    @Test
    void aConfiguredNameWinsOverTheOneTelegramReports() {
        TelegramLinks links = links(true, "@pulse_signals", "@PulseScreenerBot");
        links.reported("SomethingElseBot");

        assertThat(links.links()).isEqualTo(new TelegramLinks.Links("PulseScreenerBot", "pulse_signals"));
    }

    @Test
    void withoutAConfiguredNameTheReportedOneIsUsed() {
        TelegramLinks links = links(true, "", "");
        assertThat(links.links()).isEqualTo(new TelegramLinks.Links("", ""));

        links.reported("PulseScreenerBot");

        assertThat(links.links().bot()).isEqualTo("PulseScreenerBot");
    }

    @Test
    void nothingWhileTheBotIsOff() {
        assertThat(links(false, "@pulse_signals", "PulseScreenerBot").links()).isEqualTo(new TelegramLinks.Links("", ""));
    }

    @Test
    void onlyNamesThatMakeALinkComeOut() {
        assertThat(TelegramLinks.name("https://t.me/pulse_signals")).isEqualTo("pulse_signals");
        // a private channel by numeric id has no public link
        assertThat(TelegramLinks.name("-1001234567890")).isEmpty();
        assertThat(TelegramLinks.name("bad name\"><script>")).isEmpty();
        assertThat(TelegramLinks.name(null)).isEmpty();
    }
}
