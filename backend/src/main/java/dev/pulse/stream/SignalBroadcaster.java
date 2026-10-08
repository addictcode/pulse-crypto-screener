package dev.pulse.stream;

import java.util.List;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import dev.pulse.signal.SignalFired;
import dev.pulse.signal.SignalsMeasured;
import dev.pulse.signal.TapeFired;
import lombok.RequiredArgsConstructor;

/**
 * Signals go to browsers the moment they fire instead of waiting for the next market tick.
 */
@Component
@RequiredArgsConstructor
class SignalBroadcaster {

    private final MarketSocketHandler sockets;

    @EventListener
    void onSignal(SignalFired event) {
        sockets.broadcast(new StreamMessage.Signals(List.of(event.signal())));
    }

    @EventListener
    void onMeasured(SignalsMeasured event) {
        sockets.broadcast(new StreamMessage.Outcomes(event.signals()));
    }

    @EventListener
    void onTape(TapeFired event) {
        sockets.broadcast(new StreamMessage.Tape(event.items()));
    }
}
