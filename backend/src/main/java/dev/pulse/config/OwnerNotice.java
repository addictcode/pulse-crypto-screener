package dev.pulse.config;

/**
 * Something the owner should hear about: a summary of browser errors, a failed audit. The bot
 * sends it to the owner's chat when it runs ({@code TelegramBot}); whoever publishes it also logs
 * it, so without the bot nothing is lost but the message on the phone.
 */
public record OwnerNotice(String text) {
}
