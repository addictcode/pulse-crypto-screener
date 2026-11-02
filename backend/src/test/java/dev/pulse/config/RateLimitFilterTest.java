package dev.pulse.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RateLimitFilterTest {

    private final RateLimitFilter filter = new RateLimitFilter(new PulseProperties(
            null, null, null, null, null, null, null, new PulseProperties.Limits(60, 3, 10, 2)));

    @Test
    void aBurstGoesThroughAndTheNextCallWaits() {
        assertThat(filter.take("1.1.1.1", 0)).isZero();
        assertThat(filter.take("1.1.1.1", 0)).isZero();
        assertThat(filter.take("1.1.1.1", 0)).isZero();

        assertThat(filter.take("1.1.1.1", 0)).isEqualTo(1_000);
    }

    @Test
    void tokensComeBackAtTheSteadyRate() {
        for (int i = 0; i < 3; i++) {
            filter.take("1.1.1.1", 0);
        }

        assertThat(filter.take("1.1.1.1", 1_000)).isZero();
        assertThat(filter.take("1.1.1.1", 1_000)).isPositive();
    }

    @Test
    void clientsHaveTheirOwnBuckets() {
        for (int i = 0; i < 3; i++) {
            filter.take("1.1.1.1", 0);
        }

        assertThat(filter.take("2.2.2.2", 0)).isZero();
    }

    @Test
    void aFloodOfNewClientsSharesOneBucketInsteadOfFillingMemory() {
        for (int i = 0; i < RateLimitFilter.MAX_CLIENTS; i++) {
            filter.take("10.0." + (i >> 8) + "." + (i & 0xff), 0);
        }
        // the map is full of clients seen just now: newcomers are limited together
        for (int i = 0; i < 3; i++) {
            assertThat(filter.take("198.51.100." + i, 1)).isZero();
        }
        assertThat(filter.take("198.51.100.99", 1)).isPositive();
        assertThat(filter.clients()).isEqualTo(RateLimitFilter.MAX_CLIENTS + 1);

        // a client already known keeps its own bucket
        assertThat(filter.take("10.0.0.1", 1)).isZero();

        // once the old ones have been idle long enough, a newcomer gets its own bucket again
        long later = RateLimitFilter.IDLE_MS + 10;
        assertThat(filter.take("198.51.100.99", later)).isZero();
        assertThat(filter.clients()).isLessThan(10);
    }

    @Test
    void anExhaustedClientGetsTooManyRequests() throws Exception {
        MockHttpServletResponse last = null;
        for (int i = 0; i < 4; i++) {
            MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/market");
            request.addHeader(ClientAddress.HEADER, "3.3.3.3");
            last = new MockHttpServletResponse();
            filter.doFilter(request, last, new MockFilterChain());
        }

        assertThat(last.getStatus()).isEqualTo(429);
        assertThat(last.getHeader("Retry-After")).isNotNull();
    }

    @Test
    void theAppAndHealthAreNotLimited() throws Exception {
        for (int i = 0; i < 10; i++) {
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(new MockHttpServletRequest("GET", "/actuator/health"), response, new MockFilterChain());
            assertThat(response.getStatus()).isEqualTo(200);
        }
    }
}
