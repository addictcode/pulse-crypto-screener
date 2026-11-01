package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TelegramUpdateTest {

    @Test
    void russianAndNeighbouringLanguagesReadRussian() {
        assertThat(update("ru").russian()).isTrue();
        assertThat(update("ru-RU").russian()).isTrue();
        assertThat(update("uk").russian()).isTrue();
        assertThat(update("en").russian()).isFalse();
        assertThat(update("rust").russian()).isFalse();
        assertThat(update(null).russian()).isFalse();
    }

    private static TelegramUpdate update(String language) {
        return new TelegramUpdate(1, 2, "/start", "u", language);
    }
}
