"use client";

import { CalendarDays, ChartNoAxesColumnIncreasing, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { averageRating, dateKey, dateLabel, formatRating, matchTime, ratingDescription, resultFor, score, type PlayerMatch } from "@/lib/archive";
import { agent, mapInfo, type MapCatalog } from "@/lib/catalog";
import { seriesHref, type Series } from "@/lib/events";
import { EventMatchup } from "./event-matchup";
import { AgentAvatar, MapThumbnail, MatchScore } from "./presentation";

const MISSING = "—";
const RECENT_MATCHES = 5;

function threeMonthsBefore(day: string) {
  const date = new Date(day);
  const dayOfMonth = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 3);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(dayOfMonth, lastDay));
  return date.toISOString().slice(0, 10);
}

function sumKnown(matches: PlayerMatch[], valueFor: (match: PlayerMatch) => number | null | undefined) {
  let total = 0;
  for (const match of matches) {
    const value = valueFor(match);
    if (value == null) return null;
    total += value;
  }
  return total;
}

function roundAverage(matches: PlayerMatch[], rounds: number, metric: "acs" | "adr") {
  if (!rounds) return null;
  const total = sumKnown(matches, (match) => {
    if (!match.round_count) return 0;
    const value = match[metric];
    return value == null ? value : value * match.round_count;
  });
  return total == null ? null : total / rounds;
}

function summarize(matches: PlayerMatch[]) {
  let rounds = 0;
  let kills = 0;
  let deaths = 0;
  let firstKills = 0;
  for (const match of matches) {
    rounds += match.round_count;
    kills += match.kills;
    deaths += match.deaths;
    firstKills += match.first_kills;
  }
  return {
    rounds, kills, deaths, firstKills,
    assists: sumKnown(matches, (match) => match.assists),
    firstDeaths: sumKnown(matches, (match) => match.first_deaths),
    acs: roundAverage(matches, rounds, "acs"),
    adr: roundAverage(matches, rounds, "adr"),
    rating: averageRating(matches),
  };
}

function decimal(value: number | null | undefined, places = 1) {
  return value == null ? MISSING : value.toFixed(places);
}

function kda({ kills, deaths, assists }: Pick<PlayerMatch, "kills" | "deaths" | "assists">) {
  return `${kills} / ${deaths} / ${assists ?? MISSING}`;
}

function Difference({ value }: { value: number | null }) {
  if (value == null) return MISSING;
  const sign = value > 0 ? "+" : "";
  return <span className={value > 0 ? "profile-gain" : value < 0 ? "negative" : undefined}>{sign}{value}</span>;
}

function AgentIdentity({ id }: { id: string }) {
  return <span className="profile-agent"><AgentAvatar id={id} />{agent(id).name}</span>;
}

function AgentStatsRow({ stats, id }: { stats: ReturnType<typeof summarize>; id?: string }) {
  return <tr className={id ? undefined : "profile-stats-total"}>
    <th scope="row">{id ? <AgentIdentity id={id} /> : "合计"}</th>
    <td>{stats.rounds}</td>
    <td>{decimal(stats.acs)}</td>
    <td>{kda(stats)}</td>
    <td><Difference value={stats.kills - stats.deaths} /></td>
    <td>{decimal(stats.deaths ? stats.kills / stats.deaths : null, 2)}</td>
    <td>{decimal(stats.adr)}</td>
    <td>{stats.firstKills}</td>
    <td>{stats.firstDeaths ?? MISSING}</td>
    <td><Difference value={stats.firstDeaths == null ? null : stats.firstKills - stats.firstDeaths} /></td>
    <td>{formatRating(stats.rating)}</td>
  </tr>;
}

function ScopeFilters({ recentLabel, showAll, setShowAll }: {
  recentLabel: string; showAll: boolean; setShowAll: (showAll: boolean) => void;
}) {
  return <div className="filter-group" role="group" aria-label="统计范围">
    <button className="filter-button" type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>{recentLabel}</button>
    <button className="filter-button" type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>全部归档</button>
  </div>;
}

function playerSchedule(matches: PlayerMatch[], series: Series[]) {
  const byReplay = new Map(matches.map((match) => [match.match_id, match]));
  const linked = new Set<string>();
  const rows: ({ key: string; timestamp: string } & (
    { kind: "replay"; match: PlayerMatch } |
    { kind: "series"; series: Series; maps: { match: PlayerMatch; slot: number }[] }
  ))[] = [];
  for (const entry of series) {
    const maps = entry.maps.flatMap(({ replay_id, slot }) => {
      const match = replay_id ? byReplay.get(replay_id) : undefined;
      if (!match) return [];
      linked.add(match.match_id);
      return [{ match, slot }];
    });
    if (maps.length) rows.push({ key: entry.series_id, timestamp: entry.starts_at, kind: "series", series: entry, maps });
  }
  for (const match of matches) {
    if (!linked.has(match.match_id)) rows.push({ key: match.match_id, timestamp: matchTime(match), kind: "replay", match });
  }
  if (linked.size) rows.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return rows;
}

function PlayerMatchMetrics({ match }: { match: PlayerMatch }) {
  return <>
    <td>{kda(match)}</td>
    <td>{decimal(match.adr)}</td>
    <td>{decimal(match.acs)}</td>
    <td className={match.swingscore >= 0 ? "accent" : "negative"}>{score(match.swingscore)}</td>
    <td title={match.rating_version ? `Rating v${match.rating_version}` : undefined}>{formatRating(match.rating)}</td>
  </>;
}

export function PlayerStats({ matches, series = [], mapCatalog, today }: {
  matches: PlayerMatch[]; series?: Series[]; mapCatalog: MapCatalog; today: string;
}) {
  const [allAgentMatches, setAllAgentMatches] = useState(false);
  const [allMatchRows, setAllMatchRows] = useState(false);
  const cutoff = threeMonthsBefore(today);
  const agentMatches = allAgentMatches ? matches : matches.filter((match) => {
    const day = dateKey(matchTime(match));
    return day >= cutoff && day <= today;
  });
  const schedule = playerSchedule(matches, series);
  const matchRows = allMatchRows ? schedule : schedule.slice(0, RECENT_MATCHES);
  const hasSeries = matchRows.some(({ kind }) => kind === "series");
  const byAgent = new Map<string, PlayerMatch[]>();
  for (const match of agentMatches) {
    const key = agent(match.agent_id).slug ?? match.agent_id;
    const group = byAgent.get(key);
    if (group) group.push(match);
    else byAgent.set(key, [match]);
  }
  const agents = [...byAgent.values()].map((group) => ({ id: group[0].agent_id, stats: summarize(group) }))
    .sort((a, b) => b.stats.rounds - a.stats.rounds || agent(a.id).name.localeCompare(agent(b.id).name, "zh-CN"));

  return <div className="profile-stats">
    <section className="panel profile-stats-panel" id="player-agents" aria-labelledby="player-agents-title">
      <div className="section-head profile-stats-head">
        <h2 id="player-agents-title"><ChartNoAxesColumnIncreasing size={17} className="accent" aria-hidden="true" />特工数据</h2>
        <ScopeFilters recentLabel="近三月统计" showAll={allAgentMatches} setShowAll={setAllAgentMatches} />
      </div>
      {agentMatches.length ? <div className="profile-stats-scroll" tabIndex={0} role="region" aria-labelledby="player-agents-title">
        <table className="profile-agent-table">
          <thead><tr>
            <th scope="col">特工</th>
            <th scope="col" title="回合数">Round</th>
            <th scope="col" title="按回合加权的平均战斗分">ACS</th>
            <th scope="col" title="击杀 / 阵亡 / 助攻">K/D/A</th>
            <th scope="col" title="击杀减阵亡" aria-label="击杀减阵亡">+/−</th>
            <th scope="col" title="击杀 / 阵亡比">KD</th>
            <th scope="col" title="按回合加权的平均对敌伤害">ADR</th>
            <th scope="col" title="首杀">FK</th>
            <th scope="col" title="首死">FD</th>
            <th scope="col" title="首杀减首死" aria-label="首杀减首死">+/−</th>
            <th scope="col" title={ratingDescription}>Rating</th>
          </tr></thead>
          <tbody>
            <AgentStatsRow stats={summarize(agentMatches)} />
            {agents.map(({ id, stats }) => <AgentStatsRow key={id} id={id} stats={stats} />)}
          </tbody>
        </table>
      </div> : <p className="empty-inline">{matches.length ? "近三个月暂无归档比赛。" : "暂无已归档的比赛。"}</p>}
    </section>
    <section className="panel profile-stats-panel" id="player-matches" aria-labelledby="player-matches-title">
      <div className="section-head profile-stats-head">
        <h2 id="player-matches-title"><CalendarDays size={17} className="accent" aria-hidden="true" />比赛数据</h2>
        <ScopeFilters recentLabel="近5场比赛" showAll={allMatchRows} setShowAll={setAllMatchRows} />
      </div>
      {matchRows.length ? <div className="profile-stats-scroll" tabIndex={0} role="region" aria-labelledby="player-matches-title">
        <table className={hasSeries ? "profile-match-table profile-event-table" : "profile-match-table"}>
          <thead><tr>
            {hasSeries && <th scope="col">赛事</th>}
            <th scope="col">日期</th>
            <th scope="col">比赛</th>
            <th scope="col">地图</th>
            <th scope="col">特工</th>
            <th scope="col" title="击杀 / 阵亡 / 助攻">K/D/A</th>
            <th scope="col" title="每回合平均对敌伤害">ADR</th>
            <th scope="col" title="平均战斗分">ACS</th>
            <th scope="col">SwingScore</th>
            <th scope="col" title={ratingDescription}>Rating</th>
          </tr></thead>
          <tbody>
            {matchRows.flatMap((row) => {
              if (row.kind === "series") {
                const entry = row.series;
                const href = seriesHref(entry);
                return row.maps.map(({ match, slot }, index) => {
                  const info = mapInfo(match.map_id, mapCatalog);
                  return <tr className="profile-event-row" data-first={index === 0} key={match.match_id}>
                    {index === 0 && <>
                      <td className="profile-event-label" rowSpan={row.maps.length}><Link href={href}>
                        <Trophy size={18} aria-hidden="true" />
                        <span>{entry.event_name}{entry.stage && <strong>{entry.stage}</strong>}</span>
                      </Link></td>
                      <td rowSpan={row.maps.length}><time dateTime={entry.starts_at}>{dateLabel(entry.starts_at)}</time></td>
                      <td rowSpan={row.maps.length}><Link className="profile-match-link" href={href}><EventMatchup series={entry} /></Link></td>
                    </>}
                    <th scope="row"><Link className="profile-event-map" href={`${href}?map=${slot}`}>
                      <span>{info.name}</span>{info.code !== info.name && <span className="subtle">{info.code}</span>}
                    </Link></th>
                    <td><span className="profile-event-agent" title={agent(match.agent_id).name}><AgentAvatar id={match.agent_id} /></span></td>
                    <PlayerMatchMetrics match={match} />
                  </tr>;
                });
              }
              const { match } = row;
              const info = mapInfo(match.map_id, mapCatalog);
              const outcome = resultFor(match);
              const timestamp = matchTime(match);
              const date = dateLabel(timestamp);
              const dateSource = match.played_at ? "比赛日期" : "导入日期";
              return <tr key={match.match_id}>
                {hasSeries && <td />}
                <td><time dateTime={timestamp} aria-label={`${dateSource} ${date}`}>{date}</time>{!match.played_at && <small aria-hidden="true">（导入）</small>}</td>
                <td><Link className="profile-match-link" href={`/matches/${match.match_id}`}
                  aria-label={`${dateSource} ${date}，${info.name}比赛详情，${outcome}，蓝方 ${match.blue_score} 比 红方 ${match.red_score}`}>
                  <span className="profile-outcome" data-result={outcome}>{outcome}</span><MatchScore match={match} />
                </Link></td>
                <th scope="row"><span className="record-map">
                  <MapThumbnail id={match.map_id} catalog={mapCatalog} />
                  <span className="identity"><strong>{info.name}</strong><small>{info.code}</small></span>
                </span></th>
                <td><AgentIdentity id={match.agent_id} /></td>
                <PlayerMatchMetrics match={match} />
              </tr>;
            })}
          </tbody>
        </table>
      </div> : <p className="empty-inline">暂无已归档的比赛。</p>}
    </section>
  </div>;
}
