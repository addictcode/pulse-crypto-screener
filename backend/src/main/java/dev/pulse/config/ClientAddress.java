package dev.pulse.config;

import org.springframework.http.HttpHeaders;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Who is asking, as far as limits are concerned. Caddy works out the visitor's address (through
 * the Cloudflare tunnel too) and always overwrites this header, so a client cannot pick its own.
 * Without Caddy in front (local runs) the socket address is used.
 */
public final class ClientAddress {

    public static final String HEADER = "X-Client-IP";

    private ClientAddress() {
    }

    public static String of(HttpServletRequest request) {
        return orElse(request.getHeader(HEADER), request.getRemoteAddr());
    }

    public static String of(HttpHeaders headers, String fallback) {
        return orElse(headers.getFirst(HEADER), fallback);
    }

    private static String orElse(String header, String fallback) {
        return header == null || header.isBlank() ? String.valueOf(fallback) : header.strip();
    }
}
