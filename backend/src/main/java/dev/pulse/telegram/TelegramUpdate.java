package dev.pulse.telegram;

/**
 * An incoming text message. {@code text} is null for stickers, photos and the like.
 */
record TelegramUpdate(long updateId, long chatId, String text, String username) {
}
