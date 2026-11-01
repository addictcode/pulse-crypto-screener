package dev.pulse.telegram;

/**
 * An incoming text message. {@code text} is null for stickers, photos and the like;
 * {@code language} is the sender's Telegram app language ("ru", "en-US"), null when not sent.
 */
record TelegramUpdate(long updateId, long chatId, String text, String username, String language) {

    TelegramUpdate(long updateId, long chatId, String text, String username) {
        this(updateId, chatId, text, username, null);
    }

    /** Russian, and the languages whose speakers mostly read it, get the Russian greeting and help. */
    boolean russian() {
        return language != null && language.toLowerCase(java.util.Locale.ROOT).matches("(ru|uk|be|kk)([-_].*)?");
    }
}
