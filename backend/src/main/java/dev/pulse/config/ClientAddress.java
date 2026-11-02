package dev.pulse.config;

import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;

import org.springframework.http.HttpHeaders;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Who is asking, as far as limits are concerned. Caddy works out the visitor's address (through
 * the Cloudflare tunnel too) and always overwrites this header, so a client cannot pick its own.
 * Without Caddy in front (local runs) the socket address is used.
 *
 * <p>An IPv6 visitor is named by the /64 network, not the address: a phone or a home router gets
 * a whole /64 and may use any address in it, so per-address limits would be one script's loop
 * away from not limiting anything.
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
        return network(header == null || header.isBlank() ? String.valueOf(fallback) : header.strip());
    }

    /** IPv4 as it is; IPv6 cut to its /64, written like {@code 2001:db8:0:1::/64}. */
    static String network(String address) {
        if (address.indexOf(':') < 0) {
            return address;
        }
        try {
            // a string with a colon is taken as an IPv6 literal: checked, never looked up in DNS
            InetAddress parsed = InetAddress.getByName(address);
            if (!(parsed instanceof Inet6Address)) {
                return parsed.getHostAddress();
            }
            byte[] b = parsed.getAddress();
            return String.format("%x:%x:%x:%x::/64",
                    (b[0] & 0xff) << 8 | (b[1] & 0xff), (b[2] & 0xff) << 8 | (b[3] & 0xff),
                    (b[4] & 0xff) << 8 | (b[5] & 0xff), (b[6] & 0xff) << 8 | (b[7] & 0xff));
        } catch (UnknownHostException | SecurityException e) {
            return address;
        }
    }
}
