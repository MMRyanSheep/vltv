"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, Search, UsersRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { dateKey, matchTime, timeLabel, type MatchSummary, type ProfileEntry } from "@/lib/archive";
import { agent, mapInfo, playerName, type ArchiveMap, type MapCatalog } from "@/lib/catalog";
import { AgentAvatar, MapThumbnail, MatchScore } from "./presentation";
import { usePlayedDates } from "./shell";

const PAGE_SIZE = 8;
const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" });
const calendarMonth = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: "UTC" });

function shiftDay(day: string, offset: number) {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function Records({ matches, profiles, maps, mapCatalog, showPlayers, today }: {
  matches: MatchSummary[]; profiles: ProfileEntry[]; maps: ArchiveMap[]; mapCatalog: MapCatalog;
  showPlayers: boolean; today: string;
}) {
  const latestDay = matches[0] ? dateKey(matchTime(matches[0])) : today;
  const playedDates = usePlayedDates();
  const [search, setSearch] = useState("");
  const [map, setMap] = useState("");
  const [page, setPage] = useState(0);
  const [day, setDay] = useState(latestDay);
  const [week, setWeek] = useState(day);
  const [time, setTime] = useState("");
  const searchTerm = search.trim().toLowerCase();
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(week, index - (new Date(week).getUTCDay() + 6) % 7));

  const entries = matches.map((match) => {
    const timestamp = matchTime(match);
    return { match, timestamp, info: mapInfo(match.map_id, mapCatalog), date: dateKey(timestamp), clock: timeLabel(timestamp) };
  });
  const archiveDays = new Set(entries.map((entry) => entry.date));
  const dayRows = entries.filter(({ date }) => !day || day === date);
  const times = [...new Set(dayRows.map(({ clock }) => clock))].sort();
  const matchRows = dayRows.filter(({ info, clock, match }) =>
    (!time || time === clock) && (!map || map === info.code) &&
    [info.name, info.code, match.map_id, match.match_id].some((value) => value.toLowerCase().includes(searchTerm)));
  const playerRows = profiles.filter((player) =>
    [playerName(player), agent(player.agent_id).name, player.player_id].some((value) => value.toLowerCase().includes(searchTerm)));
  const count = showPlayers ? playerRows.length : matchRows.length;
  const pageCount = Math.ceil(count / PAGE_SIZE);
  const currentPage = Math.max(0, Math.min(page, pageCount - 1));
  const start = currentPage * PAGE_SIZE;
  const dateGroups = new Map<string, typeof matchRows>();
  for (const entry of matchRows.slice(start, start + PAGE_SIZE)) {
    const group = dateGroups.get(entry.date);
    if (group) group.push(entry);
    else dateGroups.set(entry.date, [entry]);
  }

  function selectDay(value: string) {
    setDay(value);
    if (value) setWeek(value);
    setTime("");
    setPage(0);
  }

  function selectMap(value: string) {
    setMap(value);
    setPage(0);
  }

  return <section id="matches" className="panel records" aria-labelledby="records-title">
    {!showPlayers && <div className="map-entries" role="group" aria-label="地图入口">
      <button type="button" className="map-entry" aria-pressed={!map} onClick={() => selectMap("")}>
        <span className="map-entry-icon"><LayoutGrid size={18} aria-hidden="true" /></span>
        <span className="identity"><strong>所有地图</strong><small>{matches.length} 场</small></span>
      </button>
      {maps.map(({ code, name, count }) => <button type="button" className="map-entry" key={code}
        aria-pressed={map === code} onClick={() => selectMap(code)}>
        <MapThumbnail id={code} catalog={mapCatalog} />
        <span className="identity"><strong>{name}</strong><small>{count} 场</small></span>
      </button>)}
    </div>}
    <div className="record-filters">
      <h2 id="records-title">
        {showPlayers ? <UsersRound size={16} className="accent" aria-hidden="true" /> : <CalendarDays size={16} className="accent" aria-hidden="true" />}
        {showPlayers ? "归档选手" : "比赛记录"}
      </h2>
      {!showPlayers && <>
        <div className="filter-group">
          <button className="filter-button" type="button" aria-pressed={!day} onClick={() => selectDay("")}>全部日期</button>
          <input className="date-input" type="date" aria-label="选择比赛记录日期" value={day} onChange={(event) => selectDay(event.target.value)} />
        </div>
        <div className="filter-group">
          <span className="filter-select">
            <select aria-label="筛选比赛记录时间" value={time} disabled={!times.length}
              onChange={(event) => { setTime(event.target.value); setPage(0); }}>
              <option value="">全部时间</option>
              {times.map((clock) => <option value={clock} key={clock}>{clock}</option>)}
            </select>
            <ChevronDown size={12} aria-hidden="true" />
          </span>
          <span className="filter-select">
            <select aria-label="筛选地图" value={map} onChange={(event) => selectMap(event.target.value)}>
              <option value="">所有地图</option>
              {maps.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
            </select>
            <ChevronDown size={12} aria-hidden="true" />
          </span>
        </div>
      </>}
      <label className="search-field"><Search size={14} aria-hidden="true" />
        <input type="search" aria-label={showPlayers ? "搜索选手" : "搜索比赛"} value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(0); }}
          placeholder={showPlayers ? "搜索选手、英雄或编号" : "搜索地图或比赛 ID"} />
      </label>
    </div>
    {!showPlayers && <div className="calendar">
      <strong className="calendar-month">{calendarMonth.format(new Date(week))}</strong>
      <div className="week-picker" role="group" aria-label="按周选择比赛记录日期">
        <button className="icon-button" type="button" aria-label="上一周" onClick={() => setWeek(shiftDay(week, -7))}><ChevronLeft size={17} /></button>
        <div className="week-days">
          {days.map((date) => <button type="button" className="calendar-day" key={date}
            aria-label={date + (archiveDays.has(date) ? "，有比赛" : "")}
            aria-pressed={date === day} disabled={playedDates && !archiveDays.has(date) && date !== day} onClick={() => selectDay(date)}>
            <strong>{date.slice(5).replace("-", ".")}</strong>
            <small>{date === today ? "今天" : weekday.format(new Date(date))}</small>
            <span className={archiveDays.has(date) ? "date-dot has-matches" : "date-dot"} aria-hidden="true" />
          </button>)}
        </div>
        <button className="icon-button" type="button" aria-label="下一周" onClick={() => setWeek(shiftDay(week, 7))}><ChevronRight size={17} /></button>
      </div>
      {matches.length > 0 && <button type="button" className="button button-outline button-small latest-date"
        onClick={() => selectDay(latestDay)}>最近比赛</button>}
    </div>}
    {count === 0 && <p className="empty-inline records-empty">
      {searchTerm || map || time ? "未找到符合条件的记录。" :
        showPlayers || !matches.length ? "暂无已导入的数据。" : "该日期暂无归档比赛。"}
    </p>}
    {count > 0 && !showPlayers && <div className="record-list">
      {[...dateGroups].map(([date, rows]) => (
        <div className="record-day" key={date}>
          <div className="date-heading">
            <strong><time dateTime={date}>{date.replaceAll("-", ".")}</time></strong>
            <span>{date === today ? "今天" : weekday.format(new Date(date))}</span>
            <span className="date-context">UTC+8</span>
          </div>
          {rows.map(({ match, timestamp, info, clock }) => <Link className="record-row match-row" key={match.match_id} href={`/matches/${match.match_id}`}>
            <span className="record-timestamp">
              <time dateTime={timestamp} className="record-date mono" aria-label={`${match.played_at ? "比赛时间" : "导入时间"} ${clock}`}>{clock}</time>
              {!match.played_at && <small aria-hidden="true">导入</small>}
            </span>
            <span className="record-map"><MapThumbnail id={match.map_id} catalog={mapCatalog} /><span className="identity">
              <strong>{info.name}</strong><small>{info.code}</small>
            </span></span>
            <MatchScore match={match} />
            <span className="record-rounds">{match.round_count} 回合</span>
            <span className="record-version mono">{match.patch_version && `v${match.patch_version}`}</span>
            <ChevronRight size={17} className="subtle" aria-hidden="true" />
          </Link>)}
        </div>
      ))}
    </div>}
    {showPlayers && playerRows.slice(start, start + PAGE_SIZE).map((player) => (
      <Link className="record-row profile-row" key={player.player_id} href={`/players/${player.player_id}`}>
        <span className="record-map"><AgentAvatar id={player.agent_id} player={player} /><span className="identity">
          <strong>{playerName(player)}</strong><small className="mono">#{player.player_id.slice(0, 8)}</small>
        </span></span>
        <span className="subtle">{player.match_count} 场</span>
        <ChevronRight size={17} className="subtle" aria-hidden="true" />
      </Link>
    ))}
    {pageCount > 1 && <div className="pagination">
      <span>第 {start + 1}–{Math.min(start + PAGE_SIZE, count)} 条，共 {count} 条</span>
      <div>
        <button className="icon-button" type="button" aria-label="上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button>
        <button className="icon-button" type="button" aria-label="下一页" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button>
      </div>
    </div>}
  </section>;
}
