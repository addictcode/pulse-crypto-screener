package dev.pulse.clienterror;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ClientErrorControllerTest {

    private final List<ClientError> counted = new ArrayList<>();
    private final ClientErrorLog log = new ClientErrorLog() {
        @Override
        public void count(ClientError error, Instant at) {
            counted.add(error);
        }

        @Override
        public List<Row> unreported() {
            return List.of();
        }

        @Override
        public void reported(List<Row> rows) {
        }

        @Override
        public int forgetBefore(Instant cutoff) {
            return 0;
        }
    };

    private MockMvc mvc(boolean enabled) {
        Clock clock = Clock.fixed(Instant.parse("2026-11-09T10:00:00Z"), ZoneOffset.UTC);
        return MockMvcBuilders.standaloneSetup(new ClientErrorController(log, enabled, clock, new ClientErrorGate(() -> 0.5))).build();
    }

    @Test
    void aReportIsCountedAndAnsweredWithNoContent() throws Exception {
        mvc(true).perform(post("/api/client-errors").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"boom\",\"stack\":\"at x\",\"page\":\"/app/?a=1\",\"build\":\"b1\",\"lang\":\"ru\",\"ip\":\"1.2.3.4\"}"))
                .andExpect(status().isNoContent());
        assertThat(counted).containsExactly(new ClientError("boom", "at x", "/app/", "b1", "ru"));
    }

    @Test
    void switchedOffItStillAnswersButKeepsNothing() throws Exception {
        mvc(false).perform(post("/api/client-errors").contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"boom\"}"))
                .andExpect(status().isNoContent());
        assertThat(counted).isEmpty();
    }

    @Test
    void aReportWithoutAMessageIsIgnored() throws Exception {
        mvc(true).perform(post("/api/client-errors").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isNoContent());
        assertThat(counted).isEmpty();
    }
}
