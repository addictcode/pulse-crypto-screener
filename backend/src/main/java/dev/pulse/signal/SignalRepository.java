package dev.pulse.signal;

import java.time.Instant;
import java.util.List;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

interface SignalRepository extends JpaRepository<SignalEntity, Long> {

    List<SignalEntity> findByOrderByFiredAtDesc(Pageable page);

    List<SignalEntity> findBySymbolOrderByFiredAtDesc(String symbol, Pageable page);

    long countByFiredAtAfter(Instant since);

    List<SignalEntity> findByFiredAtAfterOrderByFiredAtAsc(Instant since);
}
