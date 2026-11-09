package dev.pulse.clienterror;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.config.OwnerNotice;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class ClientErrorLogIT {

    @Autowired
    private ClientErrorController controller;
    @Autowired
    private ClientErrorLog errors;

    @Test
    void anErrorFromAPageReachesTheCounterAndARepeatAddsNoRow() throws Exception {
        String body = """
                {"message":"ClientErrorLogIT %s","stack":"Error: x\\n    at f (/assets/main-AbC123xy.js:1:%d)","page":"/app/","build":"t","lang":"en"}""";
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller).build();
        String marker = String.valueOf(System.nanoTime());
        for (int i = 0; i < 3; i++) {
            mvc.perform(post("/api/client-errors").contentType(MediaType.APPLICATION_JSON).content(body.formatted(marker, 100 + i))
                            .header("X-Client-IP", "203.0.113.7"))
                    .andExpect(status().isNoContent());
        }
        List<ClientErrorLog.Row> rows = errors.unreported().stream().filter(r -> r.message().endsWith(marker)).toList();
        assertThat(rows).singleElement().satisfies(r -> {
            assertThat(r.count()).isEqualTo(3);
            assertThat(r.newCount()).isEqualTo(3);
        });

        // the summary tells it once; a fourth report makes it news again, counted from there
        List<Object> told = new ArrayList<>();
        new ClientErrorSummary(errors, told::add, true, java.time.Clock.systemUTC()).daily();
        assertThat(told).anySatisfy(n -> assertThat(((OwnerNotice) n).text()).contains(marker).contains("×3"));
        assertThat(errors.unreported()).noneMatch(r -> r.message().endsWith(marker));
        mvc.perform(post("/api/client-errors").contentType(MediaType.APPLICATION_JSON).content(body.formatted(marker, 1)))
                .andExpect(status().isNoContent());
        assertThat(errors.unreported()).filteredOn(r -> r.message().endsWith(marker)).singleElement()
                .satisfies(r -> assertThat(r.newCount()).isEqualTo(1));

        assertThat(errors.forgetBefore(Instant.now().plusSeconds(60))).isGreaterThanOrEqualTo(1);
        assertThat(errors.unreported()).noneMatch(r -> r.message().endsWith(marker));
    }
}
