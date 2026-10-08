package dev.pulse.signal;

import java.time.Instant;
import java.util.List;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

interface SignalRepository extends JpaRepository<SignalEntity, Long> {

    List<SignalEntity> findByOrderByFiredAtDesc(Pageable page);

    List<SignalEntity> findBySymbolOrderByFiredAtDesc(String symbol, Pageable page);

    long countByFiredAtAfter(Instant since);

    List<SignalEntity> findByFiredAtAfterOrderByFiredAtAsc(Instant since);

    List<SignalEntity> findByFiredAtBetweenAndRet5mIsNull(Instant from, Instant to);

    List<SignalEntity> findByFiredAtBetweenAndRet15mIsNull(Instant from, Instant to);

    List<SignalEntity> findByFiredAtBetweenAndRet1hIsNull(Instant from, Instant to);

    /**
     * One row per signal type and direction. The database does the counting: {@code count(x)}
     * skips NULLs, so each horizon counts only the signals already measured at it.
     */
    @Query("""
            select new dev.pulse.signal.OutcomeRow(s.type, s.direction,
                count(s.ret5m), avg(s.ret5m), sum(case when s.ret5m > 0 then 1 else 0 end),
                count(s.ret15m), avg(s.ret15m), sum(case when s.ret15m > 0 then 1 else 0 end),
                count(s.ret1h), avg(s.ret1h), sum(case when s.ret1h > 0 then 1 else 0 end))
            from SignalEntity s
            where s.firedAt >= :since
            group by s.type, s.direction
            """)
    List<OutcomeRow> outcomesSince(Instant since);
}
