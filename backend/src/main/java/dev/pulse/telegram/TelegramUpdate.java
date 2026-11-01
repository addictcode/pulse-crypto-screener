package dev.pulse.telegram;

/**
 * An incoming update: a message, or a step of a payment. {@code text} is null for stickers, photos
 * and payment updates; {@code language} is the sender's Telegram app language ("ru", "en-US"), null
 * when not sent.
 *
 * @param preCheckout Telegram asks whether to take the Stars for an invoice; null otherwise
 * @param payment     the Stars were taken (a message carrying successful_payment); null otherwise
 */
record TelegramUpdate(long updateId, long chatId, String text, String username, String language, PreCheckout preCheckout,
                      Payment payment) {

    TelegramUpdate(long updateId, long chatId, String text, String username) {
        this(updateId, chatId, text, username, null, null, null);
    }

    TelegramUpdate(long updateId, long chatId, String text, String username, String language) {
        this(updateId, chatId, text, username, language, null, null);
    }

    /** Russian, and the languages whose speakers mostly read it, get the Russian greeting and help. */
    boolean russian() {
        return language != null && language.toLowerCase(java.util.Locale.ROOT).matches("(ru|uk|be|kk)([-_].*)?");
    }

    /** Must be answered within 10 seconds, or the payment fails for the buyer. */
    record PreCheckout(String id, String currency, int amount, String payload) {
    }

    /** @param chargeId Telegram's charge id: unique, and what a refund needs */
    record Payment(String currency, int amount, String payload, String chargeId) {
    }
}
