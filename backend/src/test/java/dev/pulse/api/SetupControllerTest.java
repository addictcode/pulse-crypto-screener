package dev.pulse.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.setup.SetupJournal;

class SetupControllerTest {

    private final SetupJournal journal = mock(SetupJournal.class);
    private final SetupController controller = new SetupController(journal);

    @Test
    void theDefaultBoardIsBuiltOnceForACrowd() {
        when(journal.open()).thenReturn(List.of());
        when(journal.closed(anyInt())).thenReturn(List.of());
        when(journal.stats(any())).thenReturn(List.of());

        for (int i = 0; i < 30; i++) {
            controller.board(SetupController.DEFAULT_DAYS, SetupController.DEFAULT_LIMIT);
        }
        verify(journal, times(1)).stats(any());

        // anything else is what was asked, fresh
        controller.board(30, 10);
        verify(journal, times(2)).stats(any());
        assertThat(controller.board(SetupController.DEFAULT_DAYS, SetupController.DEFAULT_LIMIT).open()).isEmpty();
    }
}
