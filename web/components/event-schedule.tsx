"use client";

import { CalendarDays, Clapperboard, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { dateKey, timeLabel } from "@/lib/archive";
import { eventHref, seriesCountdown, seriesHref, seriesLiveWindowMs, seriesStatus, seriesStatusAt, type EventInfo, type Series } from "@/lib/events";
import { EventMatchup } from "./event-matchup";

const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long", timeZone: "UTC" });

function ScheduleRow({ match, tier, now }: { match: Series; tier: EventInfo["tier"]; now: number }) {
  const startsAt = match.starts_at;
  const status = seriesStatusAt(match, now);
  const countdown = status === "scheduled" ? seriesCountdown(startsAt, now) : null;
  return <Link className="record-row event-detail-row" href={seriesHref(match)}>
    <span className="event-detail-time">
      <time className="record-date mono" dateTime={startsAt} title="计划开赛时间（北京时间）">{timeLabel(startsAt)}</time>
      {countdown && <span role="timer" className="event-countdown mono" aria-label={`倒计时 ${countdown}`}>倒计时 {countdown}</span>}
      {status !== "scheduled" && <span className="event-status" data-status={status}>{seriesStatus[status]}</span>}
    </span>
    <span className="mono event-detail-format">(BO{match.best_of})</span>
    <EventMatchup series={{ ...match, status }} showVersus />
    <span className="event-detail-status">
      {status === "scheduled" && <span className="event-status">{seriesStatus.scheduled}</span>}
      {match.maps.some((map) => map.replay_id) && <Clapperboard className="event-row-replays" size={15} aria-label="有回放" />}
    </span>
    <span className="event-detail-label">
      <Trophy size={19} aria-hidden="true" />
      <span className="event-detail-name">{match.event_name}{match.stage && <small>{match.stage}</small>}</span>
      {tier && <span className="event-tier mono" data-tier={tier} aria-label={`赛事评级 ${tier}`}>{tier}</span>}
    </span>
  </Link>;
}

export function EventSchedule({ series, events, tier, initialNow }: {
  series: Series[]; events?: EventInfo[]; tier?: EventInfo["tier"]; initialNow: number;
}) {
  const [day, setDay] = useState("");
  const [eventId, setEventId] = useState("");
  const [now, setNow] = useState(initialNow);
  const eventTiers = useMemo(() => new Map(events?.map((event) => [event.event_id, event.tier])), [events]);
  useEffect(() => {
    const starts = series.filter((match) => match.status === "scheduled").map((match) => Date.parse(match.starts_at));
    let timer: number | undefined;
    function tick() {
      const currentTime = Date.now();
      setNow(currentTime);
      let nextTick = Infinity;
      for (const start of starts) {
        if (currentTime < start) nextTick = Math.min(nextTick, start, currentTime + 1000);
        else if (currentTime < start + seriesLiveWindowMs) nextTick = Math.min(nextTick, start + seriesLiveWindowMs);
      }
      if (Number.isFinite(nextTick)) timer = window.setTimeout(tick, nextTick - currentTime);
    }
    tick();
    return () => window.clearTimeout(timer);
  }, [series]);

  const groups = useMemo(() => {
    const grouped = new Map<string, Series[]>();
    const ordered = [...series].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    for (const match of ordered) {
      const date = dateKey(match.starts_at);
      if ((day && day !== date) || (eventId && eventId !== match.event_id)) continue;
      const entries = grouped.get(date);
      if (entries) entries.push(match);
      else grouped.set(date, [match]);
    }
    return grouped;
  }, [day, eventId, series]);
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
        {matches.map((match) => <ScheduleRow key={match.series_id} match={match} tier={eventTiers.get(match.event_id) ?? tier} now={now} />)}
      </section>)}
    </section>
    {events && events.length > 0 && <section className="panel event-directory" aria-label="赛事列表">
      {events.map((event) => <Link href={eventHref(event.event_id)} key={event.event_id} className="button button-outline">
        <Trophy size={15} aria-hidden="true" />{event.name}
      </Link>)}
    </section>}
  </>;
}
