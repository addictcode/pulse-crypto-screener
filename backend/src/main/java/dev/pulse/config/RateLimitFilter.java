package dev.pulse.config;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * A token bucket per client address in front of the API. Most endpoints answer from memory, but
 * chart history and positioning go to Binance on a cache miss, and Binance limits the whole
 * server: one script walking through pairs would otherwise stall the order books for everyone.
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    /** Buckets idle this long are full again anyway, so they can be forgotten. */
    static final long IDLE_MS = 10 * 60_000;
    static final int MAX_CLIENTS = 50_000;

    private final double perMs;
    private final int burst;
    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    public RateLimitFilter(PulseProperties properties) {
        this.perMs = properties.limits().requestsPerMinute() / 60_000.0;
        this.burst = properties.limits().burst();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long now = System.currentTimeMillis();
        long waitMs = take(ClientAddress.of(request), now);
        if (waitMs > 0) {
            response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
            response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(Math.max(1, waitMs / 1000)));
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"status\":429,\"error\":\"Too Many Requests\"}");
            return;
        }
        chain.doFilter(request, response);
    }

    /** @return 0 if the call may go ahead, otherwise how long until it could */
    long take(String client, long now) {
        if (buckets.size() >= MAX_CLIENTS) {
            buckets.values().removeIf(b -> now - b.updatedAt >= IDLE_MS);
        }
        Bucket bucket = buckets.computeIfAbsent(client, k -> new Bucket(burst, now));
        synchronized (bucket) {
            bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.updatedAt) * perMs);
            bucket.updatedAt = now;
            if (bucket.tokens >= 1) {
                bucket.tokens -= 1;
                return 0;
            }
            return (long) Math.ceil((1 - bucket.tokens) / perMs);
        }
    }

    private static final class Bucket {
        double tokens;
        long updatedAt;

        Bucket(double tokens, long updatedAt) {
            this.tokens = tokens;
            this.updatedAt = updatedAt;
        }
    }
}
