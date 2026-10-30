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
