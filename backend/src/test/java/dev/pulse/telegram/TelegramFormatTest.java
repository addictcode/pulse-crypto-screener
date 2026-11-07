package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;

class TelegramFormatTest {

    private static final String SITE = "https://addictcode.github.io/pulse-crypto-screener/";

    @Test
    void theSiteLinkCarriesTheTelegramTag() {
        assertThat(TelegramFormat.siteLine(SITE, false))
                .isEqualTo("Chart and the whole market: <a href=\"" + SITE + "?utm_source=telegram\">Pulse</a>");
        assertThat(TelegramFormat.siteLine(SITE + "?lang=ru", true))
                .isEqualTo("График и весь рынок: <a href=\"" + SITE + "?lang=ru&amp;utm_source=telegram\">Pulse</a>");
    }

    @Test
    void noSiteNoLink() {
        assertThat(TelegramFormat.siteLine("", false)).isEmpty();
        assertThat(TelegramFormat.siteLine(null, true)).isEmpty();
    }

    @Test
    void aChannelPostLinksTheSiteBeforeTheDisclaimer() {
        Signal pump = new Signal(1L, SignalType.PUMP, "SOLUSDT", 0, 100, 2.5, "SOL jumps 2.5% in five minutes", "Price 100.");
        String post = TelegramFormat.channel(List.of(pump), Map.of("SOLUSDT", 101.0), 5, "PulseBot", SITE);

        assertThat(post).contains("@PulseBot", "utm_source=telegram");
        assertThat(post.indexOf("utm_source")).isLessThan(post.indexOf("Not financial advice"));
        assertThat(TelegramFormat.channel(List.of(pump), Map.of(), 5, "", "")).doesNotContain("href");
    }
}
