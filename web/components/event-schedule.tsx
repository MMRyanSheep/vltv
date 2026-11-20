"use client";

import { CalendarDays, ChevronRight, Clapperboard, Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { dateKey, timeLabel } from "@/lib/archive";
import { eventHref, seriesHref, seriesStatus, type EventInfo, type Series } from "@/lib/events";
import { EventMatchup } from "./event-matchup";

const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long", timeZone: "UTC" });

export function EventSchedule({ series, events }: { series: Series[]; events?: EventInfo[] }) {
  const [day, setDay] = useState("");
  const [eventId, setEventId] = useState("");
  const groups = new Map<string, Series[]>();
  for (const match of series) {
    const date = dateKey(match.starts_at);
    if ((day && day !== date) || (eventId && eventId !== match.event_id)) continue;
    const entries = groups.get(date);
    if (entries) entries.push(match);
    else groups.set(date, [match]);
  }
  return <>
    <section className="panel records event-schedule" aria-labelledby="event-schedule-title">
      <div className="record-filters">
        <h2 id="event-schedule-title"><CalendarDays size={16} className="accent" aria-hidden="true" />赛程</h2>
        <div className="filter-group">
          <button className="filter-button" aria-pressed={!day} type="button" onClick={() => setDay("")}>全部日期</button>
          <input className="date-input" type="date" aria-label="赛程日期" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        {events && events.length > 0 && <div className="filter-group">
          <select aria-label="筛选赛事" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">全部赛事</option>
            {events.map((event) => <option key={event.event_id} value={event.event_id}>{event.name}</option>)}
          </select>
        </div>}
      </div>
      {groups.size === 0 && <p className="empty-inline">暂无赛程</p>}
      {[...groups].map(([date, matches]) => <section className="record-day" key={date}>
        <div className="date-heading"><strong><time dateTime={date}>{date.replaceAll("-", ".")}</time></strong>
          <span>{weekday.format(new Date(date))}</span></div>
        {matches.map((match) => <Link className="record-row event-row" key={match.series_id} href={seriesHref(match)}>
          <span className="event-row-time"><time className="record-date mono" dateTime={match.starts_at}>{timeLabel(match.starts_at)}</time>
            <span className="event-status" data-status={match.status}>{seriesStatus[match.status]}</span></span>
          <span className="mono event-format">BO{match.best_of}</span>
          <EventMatchup series={match} />
          <span className="event-row-replays">{match.maps.some((map) => map.replay_id) && <Clapperboard size={16} aria-label="有回放" />}</span>
          <span className="event-row-title">
            <Trophy size={18} aria-hidden="true" />
            <span>{events ? match.event_name : match.stage ?? match.event_name}{events && match.stage && <strong>{match.stage}</strong>}</span>
          </span>
          <ChevronRight size={16} className="subtle event-row-arrow" aria-hidden="true" />
        </Link>)}
      </section>)}
    </section>
    {events && events.length > 0 && <section className="panel event-directory" aria-label="赛事列表">
      {events.map((event) => <Link href={eventHref(event.event_id)} key={event.event_id} className="button button-outline">
        <Trophy size={15} aria-hidden="true" />{event.name}
      </Link>)}
    </section>}
  </>;
}
