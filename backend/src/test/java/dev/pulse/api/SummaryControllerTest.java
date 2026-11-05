package dev.pulse.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.springframework.beans.factory.ObjectProvider;

import dev.pulse.depth.BookSide;
import dev.pulse.depth.DensityScanner;
import dev.pulse.depth.Wall;
import dev.pulse.market.Liquidation;
import dev.pulse.market.MarketStore;
import dev.pulse.market.PositionSide;
import dev.pulse.market.SymbolMetrics;
import dev.pulse.signal.SignalHistory;
import dev.pulse.signal.TapeDetector;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class SummaryControllerTest {

    private final MarketStore store = mock(MarketStore.class);
    private final DensityScanner density = mock(DensityScanner.class);
    private final SignalHistory signals = mock(SignalHistory.class);
    @SuppressWarnings("unchecked")
    private final ObjectProvider<TapeDetector> tape = mock(ObjectProvider.class);
    private final JsonMapper mapper = JsonMapper.builder().build();
    private final AtomicLong now = new AtomicLong(1_000_000);
    private final SummaryController controller = new SummaryController(store, density, signals, tape, mapper, now::get);

    @BeforeEach
    void market() {
        when(store.snapshot(anyLong())).thenReturn(List.of(new SymbolMetrics(
                "BTCUSDT", 83_000, 0.1, 0.4, 0.6, 1.1, -1.2, 84_000.0, 82_000.0, 12e9,
                1.3, 0.8, 0.01, 1L, 6e9, 0.4, 0)));
        when(store.recentLiquidations(anyInt())).thenReturn(List.of());
        when(density.latest()).thenReturn(new DensityScanner.DensityState(5, List.of(
                new Wall("BTCUSDT", BookSide.BID, 82_500, 40, -0.6, 8, 120, null),
                new Wall("BTCUSDT", BookSide.ASK, 90_000, 40, 8.4, 8, 120, null)), Map.of("BTCUSDT", 0.1)));
        when(signals.recent(anyInt())).thenReturn(List.of());
        when(store.sparklines(ArgumentMatchers.<Collection<String>>any(), anyInt()))
                .thenAnswer(call -> {
                    Collection<String> asked = call.getArgument(0);
                    return asked.contains("ETHUSDT") ? Map.of("ETHUSDT", List.of(1.0, 1.1)) : Map.of();
                });
    }

    private JsonNode body() {
        return mapper.readTree(controller.summary().getBody());
    }

    @Test
    void aRowCarriesOnlyWhatTheLandingUses() {
        JsonNode row = body().path("rows").get(0);

        assertThat(row.propertyNames()).containsExactlyInAnyOrder("symbol", "price", "ch5m", "ch24h", "vol24h");
        assertThat(row.path("symbol").asString()).isEqualTo("BTCUSDT");
        assertThat(row.path("ch24h").asDouble()).isEqualTo(-1.2);
    }

    @Test
    void onlyWallsNearThePriceAreSent() {
        JsonNode walls = body().path("walls");

        assertThat(walls.path("walls")).hasSize(1);
        assertThat(walls.path("walls").get(0).path("side").asString()).isEqualTo("BID");
        assertThat(walls.path("coverage").path("BTCUSDT").asDouble()).isEqualTo(0.1);
        // no tape detector in this context: an empty tape, not a failure
        assertThat(body().path("tape")).isEmpty();
    }

    @Test
    void sparklinesComeOnlyForThePairsTheEventsName() {
        when(store.recentLiquidations(anyInt())).thenReturn(List.of(
                new Liquidation("ETHUSDT", PositionSide.LONG, 3000, 10, 1)));
        JsonNode sparklines = body().path("sparklines");

        assertThat(sparklines.propertyNames()).containsExactly("ETHUSDT");
        assertThat(sparklines.path("ETHUSDT")).hasSize(2);
    }

    @Test
    void aCrowdWithinTwoSecondsIsServedOneBuild() {
        for (int i = 0; i < 50; i++) {
            controller.summary();
        }
        verify(store, times(1)).snapshot(anyLong());

        now.addAndGet(SummaryController.TTL_MS);
        controller.summary();
        verify(store, times(2)).snapshot(anyLong());
    }
}
