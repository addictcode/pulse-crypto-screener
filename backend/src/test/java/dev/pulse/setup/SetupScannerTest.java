package dev.pulse.setup;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;

class SetupScannerTest {

    private static final Instant OPENED = Instant.parse("2026-10-12T10:00:00Z");

    @Test
    void aCoinCarriesOneTradeWhateverTheTimeframe() {
        List<SetupTrade> open = List.of(trade("WUSDT", "15m"));

        assertThat(SetupScanner.room(open, "WUSDT", 6)).isFalse();
        assertThat(SetupScanner.room(open, "ETHUSDT", 6)).isTrue();
    }

    @Test
    void theBookIsCapped() {
        List<SetupTrade> open = List.of(trade("WUSDT", "15m"), trade("ETHUSDT", "1h"), trade("TIAUSDT", "15m"));

        assertThat(SetupScanner.room(open, "LINKUSDT", 4)).isTrue();
        assertThat(SetupScanner.room(open, "LINKUSDT", 3)).isFalse();
    }

    private static SetupTrade trade(String symbol, String timeframe) {
        return new SetupTrade(1, symbol, timeframe, 1, 100, 99, 103, OPENED, OPENED.plusSeconds(3_600), SetupStatus.OPEN, null, null, null);
    }
}
