"use client";

import { CalendarDays, Clapperboard, Clock3, Gem, Trophy } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { dateKey, timeLabel } from "@/lib/archive";
import { eventHref, eventTiers, seriesHref, seriesStatus } from "@/lib/events";
import type { TeamEvent, TeamSeries } from "@/lib/teams";
import { EventMatchup } from "./event-matchup";

function FilterRow({ label, icon, value, options, onChange }: {
  label: string; icon: ReactNode; value: string; options: { value: string; label: string }[]; onChange: (next: string) => void;
}) {
  return <div className="team-filter-row">
    <span>{icon}{label}</span>
    <div className="team-options" role="group" aria-label={label}>
      {[{ value: "", label: "全部" }, ...options].map((option) => <button key={option.value} type="button"
        aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  </div>;
}

export function TeamSchedule({ series, events }: { series: TeamSeries[]; events: TeamEvent[] }) {
  const [year, setYear] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [eventId, setEventId] = useState("");
  const years = [...new Set(series.map((match) => dateKey(match.starts_at).slice(0, 4)))];
  const groups = new Map<string, TeamSeries[]>();
  for (const match of series) {
    const matchYear = dateKey(match.starts_at).slice(0, 4);
    if ((year && year !== matchYear) || (tier && tier !== (match.tier ?? "unrated"))
      || (status === "finished" && match.status !== "finished")
      || (status === "open" && match.status === "finished")
      || (eventId && eventId !== match.event_id)) continue;
    const rows = groups.get(matchYear) ?? [];
    rows.push(match);
    groups.set(matchYear, rows);
  }
  return <div className="team-schedule">
    <section className="team-schedule-filters" aria-label="赛程筛选">
      <FilterRow label="年份" icon={<CalendarDays size={16} />} value={year}
        options={years.map((value) => ({ value, label: value }))} onChange={setYear} />
      <FilterRow label="等级" icon={<Gem size={16} />} value={tier}
        options={[...eventTiers.map((value) => ({ value, label: `${value} 级` })), { value: "unrated", label: "未评级" }]} onChange={setTier} />
      <FilterRow label="状态" icon={<Clock3 size={16} />} value={status}
        options={[{ value: "open", label: "进行中及未开始" }, { value: "finished", label: "已结束" }]} onChange={setStatus} />
      {events.length > 0 && <label className="team-filter-row">
        <span><Trophy size={16} />赛事</span>
        <select className="team-select" value={eventId} onChange={(event) => setEventId(event.target.value)}>
          <option value="">全部赛事</option>
          {events.map((event) => <option key={event.event_id} value={event.event_id}>{event.name}</option>)}
        </select>
      </label>}
    </section>
    {groups.size === 0 && <p className="team-empty">此范围内暂无比赛。</p>}
    {[...groups].map(([key, matches]) => <section key={key} aria-labelledby={`team-year-${key}`}>
      <h2 className="team-year" id={`team-year-${key}`}>{key} 年</h2>
      <div className="team-fixtures">
        {matches.map((match) => {
          const matchup = match.target_is_a ? match : {
            ...match, team_a: match.team_b, team_b: match.team_a, score_a: match.score_b, score_b: match.score_a,
          };
          return <Link className="team-fixture" key={match.series_id} href={seriesHref(match)}>
            <span className="team-fixture-event">
              <span className="team-tier" data-tier={match.tier} aria-label={match.tier ? `${match.tier} 级` : "未评级"}>{match.tier ?? "—"}</span>
              <Trophy size={17} aria-hidden="true" />
              <span>{match.event_name}{match.stage && <small>{match.stage}</small>}</span>
            </span>
            <span className="team-fixture-format mono">BO{match.best_of}</span>
            <time className="team-fixture-time mono" dateTime={match.starts_at}>{dateKey(match.starts_at)} {timeLabel(match.starts_at)}</time>
            <EventMatchup series={matchup} />
            <span className="event-status" data-status={match.status}>{seriesStatus[match.status]}</span>
            <span className="team-fixture-replay">{match.maps.some((map) => map.replay_id) && <Clapperboard size={17} aria-label="有回放" />}</span>
          </Link>;
        })}
      </div>
    </section>)}
    {events.length > 0 && <nav className="team-event-links" aria-label="战队关联赛事">
      {events.map((event) => <Link key={event.event_id} href={eventHref(event.event_id)}><Trophy size={15} />{event.name}</Link>)}
    </nav>}
  </div>;
}
