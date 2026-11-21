import { ArrowLeft, ChartPie, Clapperboard } from "lucide-react";
import Link from "next/link";
import { EventMatchup } from "@/components/event-matchup";
import { MatchRadar } from "@/components/match-radar";
import { MapThumbnail } from "@/components/presentation";
import { Scoreboards } from "@/components/scoreboards";
import { readArchive, readMapCatalog } from "@/lib/api";
import { dateLabel, timeLabel, type MatchDetail } from "@/lib/archive";
import { mapInfo } from "@/lib/catalog";
import { eventHref, seriesHref, seriesStatus, seriesStatusAt, vetoLabels, type SeriesDetail } from "@/lib/events";
import { orientReplay, summarizeSeries } from "@/lib/series-stats";
import { LotusScoreboard } from "./lotus-scoreboard";
import "../../../events.css";

export const metadata = { title: "赛事比赛详情" };

export default async function SeriesPage({ params, searchParams }: PageProps<"/events/[id]/matches/[seriesId]">) {
  const [{ id, seriesId }, { map }] = await Promise.all([params, searchParams]);
  const href = seriesHref({ event_id: id, series_id: seriesId });
  const [series, mapCatalog] = await Promise.all([readArchive<SeriesDetail>(href), readMapCatalog()]);
  const selected = series.maps.find(({ slot }) => String(slot) === map);
  const dataMaps = selected ? [selected] : series.maps;
  const matches = await Promise.all(dataMaps.flatMap((entry) => entry.replay_id ? [
    readArchive<MatchDetail>(`/matches/${entry.replay_id}`).then((replay) => orientReplay(replay, entry)),
  ] : []));
  const detail = selected ? matches[0] : undefined;
  const combined = !selected && matches.length > 0 ? summarizeSeries(matches) : undefined;
  const stats = detail ?? combined;
  const showLotusScoreboard = series.series_id === "d23f5833-73b8-47ee-ae43-ab236902613a"
    && selected?.slot === 1 && selected.map_id === "Lotus";
  const names = { Blue: series.team_a.tag, Red: series.team_b.tag };
  const mapScore = { blue_score: selected?.score_a ?? series.score_a, red_score: selected?.score_b ?? series.score_b };
  const linkedMaps = series.maps.filter(({ replay_id }) => replay_id).length;
  const overviewLabel = linkedMaps > 0 && linkedMaps < series.score_a + series.score_b ? "已归档统计" : "全场统计";
  const status = seriesStatusAt(series, Date.now());

  return <div className="event-detail">
    <div className="breadcrumbs"><Link href={eventHref(id)}><ArrowLeft size={16} />{series.event_name}</Link></div>
    <section className="panel series-hero">
      <div className="series-hero-meta">
        <h1>{series.stage ?? series.event_name}</h1>
        <span>BO{series.best_of}</span>
        <span className="event-status" data-status={status}>{seriesStatus[status]}</span>
        <time className="mono" dateTime={series.starts_at}>{dateLabel(series.starts_at)} {timeLabel(series.starts_at)}</time>
      </div>
      <EventMatchup series={{ ...series, status }} fullNames linkTeams />
    </section>
    {series.veto.length > 0 && <section className="series-veto" aria-label="选图">
      {series.veto.map(({ action, map_id }, index) => {
        const team = action.endsWith("_a") ? names.Blue : names.Red;
        const verb = vetoLabels[action].slice(2);
        return <div className="panel" key={index}>
          {action !== "decider" && <strong>{team}</strong>}
          <span className={action.startsWith("ban") ? "negative" : "accent"}>{action === "decider" ? vetoLabels.decider : verb}</span>
          <strong>{mapInfo(map_id, mapCatalog).name}</strong>
        </div>;
      })}
    </section>}
    <section className="panel series-selector">
      <div className="section-head">
        <h2>比赛数据</h2>
        {stats && <a href="#radar" className="button button-outline">选手雷达图</a>}
      </div>
      <nav className="series-tabs" aria-label="地图与全场数据">
        <Link href={href} aria-current={!selected ? "page" : undefined}><ChartPie size={20} />{overviewLabel}</Link>
        {series.maps.map((entry) => <Link key={entry.slot} href={`${href}?map=${entry.slot}`}
          aria-current={selected?.slot === entry.slot ? "page" : undefined}>
          {entry.map_id && <MapThumbnail id={entry.map_id} catalog={mapCatalog} />}
          <span>{entry.map_id ? mapInfo(entry.map_id, mapCatalog).name : `第 ${entry.slot} 图待定`}</span>
          {entry.score_a != null && entry.score_b != null && <strong className="mono">
            <span className="blue">{entry.score_a}</span> : <span className="red">{entry.score_b}</span>
          </strong>}
        </Link>)}
      </nav>
    </section>
    {stats ? <>
      {selected?.replay_id && <div className="series-replay">
        <Link href={`/matches/${selected.replay_id}`} className="button button-outline"><Clapperboard size={16} />回放详情</Link>
      </div>}
      <Scoreboards match={{ ...stats, ...mapScore }} teamNames={names} hideScore={!selected} agentIds={combined?.agentIds} />
      <MatchRadar key={selected?.slot ?? "all"} players={stats.players} rounds={stats.rounds}
        roundCount={stats.round_count} playerRoundCounts={combined?.roundCounts} teamNames={names} />
    </> : showLotusScoreboard ? <LotusScoreboard /> : <p className="panel empty-inline">暂无回放</p>}
  </div>;
}
