package dev.pulse.clienterror;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;

/**
 * An error a visitor's browser reported, cut to size and stripped of anything that could tell one
 * visitor from another: no address, no query string, no fragment (it holds the pair, harmless,
 * but the path is enough to find the bug).
 *
 * @param message what the browser said, at most {@link #MESSAGE} characters
 * @param stack   the first lines of the stack, at most {@link #STACK} characters
 * @param page    the path of the page, e.g. {@code /app/}
 * @param build   which build of the site threw it
 * @param lang    the language the page was in
 */
public record ClientError(String message, String stack, String page, String build, String lang) {

    static final int MESSAGE = 500;
    static final int STACK = 2_000;
    static final int PAGE = 100;
    static final int BUILD = 40;
    static final int LANG = 5;

    /** What a page sent, made safe to store. */
    static ClientError of(String message, String stack, String page, String build, String lang) {
        return new ClientError(
                cut(message, MESSAGE).isEmpty() ? "(no message)" : cut(message, MESSAGE),
                cut(stack, STACK),
                cut(path(page), PAGE),
                cut(build, BUILD),
                cut(lang, LANG).toLowerCase(Locale.ROOT));
    }

    /**
     * Same error, same fingerprint: numbers (positions, ids, sizes) and the hashed file names of a
     * build do not make a new error. The message and the top frame are enough to tell bugs apart.
     */
    String fingerprint() {
        String top = stack.lines().filter(l -> !l.isBlank() && !l.strip().equals(message.strip())).findFirst().orElse("");
        String key = normalize(message) + '\n' + normalize(top) + '\n' + page;
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String normalize(String s) {
        return s.replaceAll("-[A-Za-z0-9_-]{6,}\\.js", ".js").replaceAll("\\d+", "#").strip();
    }

    private static String path(String page) {
        if (page == null) {
            return "";
        }
        String p = page.replaceFirst("^[a-z]+://[^/]*", "");
        int cut = indexOfAny(p, '?', '#');
        return cut < 0 ? p : p.substring(0, cut);
    }

    private static int indexOfAny(String s, char a, char b) {
        int i = s.indexOf(a);
        int j = s.indexOf(b);
        return i < 0 ? j : j < 0 ? i : Math.min(i, j);
    }

    private static String cut(String s, int max) {
        if (s == null) {
            return "";
        }
        String clean = s.replaceAll("[\\p{Cntrl}&&[^\n]]", " ").strip();
        return clean.length() <= max ? clean : clean.substring(0, max);
    }
}
