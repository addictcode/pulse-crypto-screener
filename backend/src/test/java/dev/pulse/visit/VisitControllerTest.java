package dev.pulse.visit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import dev.pulse.config.ClientAddress;

class VisitControllerTest {

    private final List<VisitCount> counted = new ArrayList<>();
    private final MutableClock clock = new MutableClock(Instant.parse("2026-11-01T10:00:00Z"));
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new VisitController(new VisitLog() {
        @Override
        public void count(LocalDate day, FunnelStep step, VisitSource source) {
            counted.add(new VisitCount(day, step, source, 1));
        }

        @Override
        public List<VisitCount> since(LocalDate from) {
            return counted;
        }
    }, clock)).build();

    @Test
    void aPageHitIsCountedWithItsSourceFolded() throws Exception {
        hit("1.1.1.1", "{\"page\":\"landing\",\"source\":\"www.tiktok.com\"}", 204);

        assertThat(counted).containsExactly(new VisitCount(LocalDate.of(2026, 11, 1), FunnelStep.LANDING, VisitSource.TIKTOK, 1));
    }

    @Test
    void noSourceIsDirect() throws Exception {
        hit("1.1.1.1", "{\"page\":\"app\"}", 204);

        assertThat(counted).extracting(VisitCount::source).containsExactly(VisitSource.DIRECT);
    }

    @Test
    void pagesOffTheListAreRejected() throws Exception {
        hit("1.1.1.1", "{\"page\":\"admin\",\"source\":\"tiktok\"}", 400);
        hit("1.1.1.1", "{\"source\":\"tiktok\"}", 400);
        // the bot counts its own starts; a page cannot claim one
        hit("1.1.1.1", "{\"page\":\"bot-start\",\"source\":\"tiktok\"}", 400);

        assertThat(counted).isEmpty();
    }

    @Test
    void oneAddressCountsOncePerPageAMinute() throws Exception {
        hit("1.1.1.1", "{\"page\":\"landing\"}", 204);
        hit("1.1.1.1", "{\"page\":\"landing\"}", 204);
        hit("1.1.1.1", "{\"page\":\"app\"}", 204);
        hit("2.2.2.2", "{\"page\":\"landing\"}", 204);
        assertThat(counted).hasSize(3);

        clock.advance(HitGate.WINDOW_MS);
        hit("1.1.1.1", "{\"page\":\"landing\"}", 204);

        assertThat(counted).hasSize(4);
    }

    private void hit(String address, String json, int expected) throws Exception {
        mvc.perform(post("/api/hit").header(ClientAddress.HEADER, address).contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().is(expected));
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advance(long millis) {
            now = now.plusMillis(millis);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
