package dev.pulse.telegram;

import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

import dev.pulse.config.PulseProperties;

/**
 * The bot and the channel as the site links to them. Only names that make a valid t.me link come
 * out, and nothing at all while the bot is off: a button to a bot that does not answer is worse
 * than no button.
 */
@Component
public class TelegramLinks {

    /** Telegram usernames: 4 to 32 letters, digits and underscores (5 for new ones, 4 for old). */
    private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_]{4,32}");

    /** @param bot     username without "@", or empty
     *  @param channel public channel username without "@", or empty (a numeric id has no link) */
    public record Links(String bot, String channel) {
    }

    private final PulseProperties.Telegram config;
    private volatile String reported = "";

    public TelegramLinks(PulseProperties properties) {
        this.config = properties.telegram();
    }

    /** What getMe said once the bot started; used when no name is configured. */
    void reported(String username) {
        reported = username == null ? "" : username;
    }

    public Links links() {
        if (config == null || !config.enabled()) {
            return new Links("", "");
        }
        String configured = name(config.botUsername());
        return new Links(configured.isEmpty() ? name(reported) : configured, config.hasChannel() ? name(config.channel()) : "");
    }

    static String name(String raw) {
        if (raw == null) {
            return "";
        }
        String name = raw.strip().replaceFirst("^https?://t\\.me/", "").replaceFirst("^@", "");
        return USERNAME.matcher(name).matches() ? name : "";
    }
}
