package dev.pulse.signal;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SignalTextRuTest {

    private static Signal signal(SignalType type, double value, int direction) {
        return new Signal(1L, type, "WIFUSDT", 0, 1, value, "title", "detail", direction, null, null, null);
    }

    @Test
    void saysWhatTheSiteSays() {
        assertThat(SignalTextRu.title(signal(SignalType.PUMP, 2.84, 1))).isEqualTo("WIF растёт на 2,8% за 5 минут");
        assertThat(SignalTextRu.title(signal(SignalType.DUMP, 3.1, -1))).isEqualTo("WIF падает на 3,1% за 5 минут");
        assertThat(SignalTextRu.title(signal(SignalType.VOLUME, 4.25, 1))).isEqualTo("WIF: объём в 4,3× выше часового темпа");
        assertThat(SignalTextRu.title(signal(SignalType.OPEN_INTEREST, 5, -1))).isEqualTo("Открытый интерес WIF упал на 5,0% за 15 минут");
        assertThat(SignalTextRu.title(signal(SignalType.FUNDING, 0.12, 1))).isEqualTo("WIF: фандинг +0,120%, лонги платят шортам");
        assertThat(SignalTextRu.title(signal(SignalType.LIQUIDATIONS, 1_200_000, -1))).isEqualTo("WIF: $1.2M лонгов ликвидировано за 5 минут");
        assertThat(SignalTextRu.title(signal(SignalType.WALL, 0.25, 1))).isEqualTo("WIF в 0,25% над стеной на покупку");
    }
}
