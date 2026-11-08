package dev.pulse.visit;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/**
 * Where a visitor came from, folded into a handful of buckets. A free-form source would let
 * anyone fill the table with junk rows, and the funnel only needs to tell these apart.
 */
public enum VisitSource {
    TIKTOK("tiktok"),
    TELEGRAM("telegram"),
    GOOGLE("google"),
    DIRECT("direct"),
    /** The bot opened from a button on our own site. */
    SITE("site"),
    /** The bot opened from a friend's /invite link: t.me/<bot>?start=invite. */
    INVITE("invite"),
    OTHER("other");

    private final String key;

    VisitSource(String key) {
        this.key = key;
    }

    public String key() {
        return key;
    }

    /**
     * Accepts what a page knows: a {@code utm_source} or {@code ref} value, or the referrer's host.
     * Nothing at all means the address was typed or opened from a bookmark.
     */
    public static VisitSource of(String raw) {
        if (raw == null || raw.isBlank()) {
            return DIRECT;
        }
        String value = raw.strip().toLowerCase(Locale.ROOT);
        if (value.contains("tiktok")) {
            return TIKTOK;
        }
        // t.me links, the Telegram apps and our own ?ref=tg / ?start=channel
        if (value.contains("telegram") || value.equals("t.me") || value.endsWith(".t.me") || value.equals("tg")
                || value.equals("bot") || value.equals("channel")) {
            return TELEGRAM;
        }
        if (value.contains("google")) {
            return GOOGLE;
        }
        if (value.equals("site")) {
            return SITE;
        }
        if (value.equals("invite")) {
            return INVITE;
        }
        if (value.equals("direct")) {
            return DIRECT;
        }
        return OTHER;
    }

    public static Optional<VisitSource> fromKey(String key) {
        return Arrays.stream(values()).filter(s -> s.key.equals(key)).findFirst();
    }
}
