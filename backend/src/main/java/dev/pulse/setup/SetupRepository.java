package dev.pulse.setup;

import java.time.Instant;
import java.util.List;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

interface SetupRepository extends JpaRepository<SetupEntity, Long> {

    List<SetupEntity> findByStatusOrderByOpenedAtDesc(SetupStatus status);

    List<SetupEntity> findByStatusNotOrderByClosedAtDesc(SetupStatus status, Pageable page);

    @Query("""
            select new dev.pulse.setup.SetupStats(s.timeframe, count(s), sum(case when s.resultR > 0 then 1 else 0 end), sum(s.resultR))
            from SetupEntity s
            where s.status <> dev.pulse.setup.SetupStatus.OPEN and s.closedAt >= :since
            group by s.timeframe
            order by s.timeframe
            """)
    List<SetupStats> statsSince(Instant since);

    @Query("select min(s.openedAt) from SetupEntity s")
    Instant firstOpenedAt();
}
