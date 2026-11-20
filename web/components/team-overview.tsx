"use client";

import { ChartNoAxesCombined, MapPinned, Medal, Swords, UsersRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { dateKey, formatRating, score } from "@/lib/archive";
import { agent, mapInfo, playerName, type MapCatalog } from "@/lib/catalog";
import { eventHref, placementLabel, seriesHref } from "@/lib/events";
import { opponent, seriesWon, summarizeTeamMaps, summarizeTeamPlayers, type TeamEvent, type TeamMap, type TeamSeries } from "@/lib/teams";
import { TeamLogo } from "./event-matchup";
import { AgentAvatar, MapThumbnail } from "./presentation";

const percentage = (wins: number, total: number) => total ? `${Math.round(1000 * wins / total) / 10}%` : "—";
const metric = (value: number | null) => value == null ? "—" : value.toFixed(1);

function EventFilter({ events, value, onChange, label }: {
  events: TeamEvent[]; value: string; onChange: (value: string) => void; label: string;
}) {
  return <select className="team-select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">全部赛事</option>
    {events.map((event) => <option key={event.event_id} value={event.event_id}>{event.name}</option>)}
  </select>;
}

export function TeamOverview({ maps, series, events, catalog }: {
  maps: TeamMap[]; series: TeamSeries[]; events: TeamEvent[]; catalog: MapCatalog;
}) {
  const [mapView, setMapView] = useState<"recent" | "event">("recent");
  const [mapEvent, setMapEvent] = useState("");
  const [playerEvent, setPlayerEvent] = useState("");
  const lastMap = maps.find((map) => map.players.length > 0);
  const results = series.filter((match) => match.status === "finished");
  const scoped = (row: { recent: boolean; event_id: string }) =>
    mapView === "recent" ? row.recent : !mapEvent || row.event_id === mapEvent;
  const mapStats = summarizeTeamMaps(maps.filter(scoped));
  const scopedSeries = results.filter(scoped);
  const seriesWins = scopedSeries.filter(seriesWon).length;
  const placements = events.filter((event) => event.last_match || event.first_place != null);
  const players = summarizeTeamPlayers(maps.filter((map) => !playerEvent || map.event_id === playerEvent));

  return <div className="team-overview">
    <section className="team-roster" aria-labelledby="team-roster-title">
      <header className="team-section-head">
        <h2 id="team-roster-title"><UsersRound size={17} />最近出场阵容</h2>
        {lastMap && <Link href={`${seriesHref(lastMap)}?map=${lastMap.slot}`}>{dateKey(lastMap.starts_at)} · {mapInfo(lastMap.map_id, catalog).name}</Link>}
      </header>
      {lastMap ? <div className="team-roster-grid">
        {lastMap.players.map((player) => <Link className="team-player-card" key={player.player_id} href={`/players/${player.player_id}`}>
          <AgentAvatar id={player.agent_id} player={player} />
          <strong>{playerName(player)}</strong>
          <span>{agent(player.agent_id).name}</span>
        </Link>)}
      </div> : <p className="team-empty">关联比赛回放后显示出场选手。</p>}
    </section>

    {results.length > 0 && <section className="team-form-strip" aria-label="最近比赛战绩">
      {results.slice(0, 12).map((match) => {
        const rival = opponent(match);
        const win = seriesWon(match);
        return <Link className="team-result" key={match.series_id} href={seriesHref(match)} data-win={win}
          title={`${win ? "胜" : "负"} · ${rival.name} · ${match.event_name}`}>
          <strong aria-label={win ? "胜" : "负"}>{win ? "W" : "L"}</strong><TeamLogo team={rival} /><span>{rival.tag}</span>
        </Link>;
      })}
    </section>}

    <section className="team-panel" aria-labelledby="team-maps-title">
      <header className="team-section-head">
        <h2 id="team-maps-title"><MapPinned size={17} />战队地图统计</h2>
        <div className="team-options" role="group" aria-label="地图统计范围">
          <button type="button" aria-pressed={mapView === "recent"} onClick={() => setMapView("recent")}>近三月统计</button>
          <button type="button" aria-pressed={mapView === "event"} onClick={() => setMapView("event")}>按赛事统计</button>
          {mapView === "event" && <EventFilter events={events} value={mapEvent} onChange={setMapEvent} label="地图统计赛事" />}
        </div>
      </header>
      <div className="team-table-scroll">
        <table className="team-table team-map-table">
          <thead><tr>
            <th scope="col">比赛场次<strong>{scopedSeries.length} 场 · {seriesWins} 胜 {scopedSeries.length - seriesWins} 负</strong></th>
            <th scope="col">地图<strong>{mapStats.wins + mapStats.losses}</strong></th>
            <th scope="col">地图胜率<strong>{percentage(mapStats.wins, mapStats.wins + mapStats.losses)}</strong></th>
            <th scope="col">地图 W<strong>{mapStats.wins}</strong></th>
            <th scope="col">地图 L<strong>{mapStats.losses}</strong></th>
            <th scope="col">胜率最高阵容</th><th scope="col">阵容胜率</th>
          </tr></thead>
          <tbody>{mapStats.rows.map(({ code, wins, losses, best }) => <tr key={code}>
            <th scope="row"><span className="team-map-label"><MapThumbnail id={code} catalog={catalog} />
              <span>{mapInfo(code, catalog).name} <small>{mapInfo(code, catalog).name !== code && code}</small></span>
            </span></th>
            <td>{wins + losses}</td><td>{percentage(wins, wins + losses)}</td><td>{wins}</td><td>{losses}</td>
            <td>{best ? <span className="team-lineup">{best.agents.map((id) =>
              <span key={id} title={agent(id).name}><AgentAvatar id={id} /><span className="sr-only">{agent(id).name}</span></span>)}</span> : "—"}</td>
            <td>{best ? <><span className="subtle">[{best.wins + best.losses}]</span> {percentage(best.wins, best.wins + best.losses)}</> : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {mapStats.rows.length === 0 && <p className="team-empty">此范围内暂无可统计胜负的地图回放。</p>}
    </section>

    <section className="team-panel" aria-labelledby="team-placements-title">
      <header className="team-section-head"><h2 id="team-placements-title"><Medal size={17} />赛事名次</h2></header>
      {placements.length ? <div className="team-table-scroll">
        <table className="team-table team-placements">
          <thead><tr><th scope="col">最近比赛</th><th scope="col">等级</th><th scope="col">赛事</th><th scope="col">名次</th></tr></thead>
          <tbody>{placements.map((event) => <tr key={event.event_id}>
            <td>{event.last_match ? <time dateTime={event.last_match}>{dateKey(event.last_match)}</time> : "—"}</td>
            <td><span className="team-tier" data-tier={event.tier}>{event.tier ?? "—"}</span></td>
            <th scope="row"><Link href={eventHref(event.event_id)}><Swords size={16} />{event.name}</Link></th>
            <td>{event.first_place != null && event.last_place != null
              ? placementLabel(event.first_place, event.last_place) : "待录入"}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="team-empty">暂无赛事名次。</p>}
    </section>

    <section className="team-panel" aria-labelledby="team-player-stats-title">
      <header className="team-section-head"><h2 id="team-player-stats-title"><ChartNoAxesCombined size={17} />选手数据</h2>
        <EventFilter events={events} value={playerEvent} onChange={setPlayerEvent} label="选手数据赛事" />
        <p>仅统计代表本战队出场的已归档地图</p>
      </header>
      {players.length ? <div className="team-table-scroll">
        <table className="team-table team-player-table">
          <thead><tr>{["选手", "地图", "Rating", "SwingScore", "击杀", "阵亡", "助攻", "ACS", "ADR", "KAST"].map((name) =>
            <th key={name} scope="col">{name}</th>)}</tr></thead>
          <tbody>{players.map(({ player, mapCount, kills, deaths, assists, rating, swingscore, acs, adr, kast }) => <tr key={player.player_id}>
            <th scope="row"><Link href={`/players/${player.player_id}`}><AgentAvatar id={player.agent_id} player={player} />{playerName(player)}</Link></th>
            <td>{mapCount}</td><td>{formatRating(rating)}</td><td>{swingscore == null ? "—" : score(swingscore)}</td>
            <td>{kills}</td><td>{deaths}</td><td>{assists ?? "—"}</td><td>{metric(acs)}</td><td>{metric(adr)}</td><td>{kast == null ? "—" : `${metric(kast)}%`}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="team-empty">此范围内暂无选手出场数据。</p>}
    </section>
  </div>;
}
