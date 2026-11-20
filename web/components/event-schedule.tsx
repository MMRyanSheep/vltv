"use client";

import { CalendarDays, ChevronRight, Clapperboard, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { dateKey, timeLabel } from "@/lib/archive";
import { eventHref, seriesCountdown, seriesHref, seriesStartTime, seriesStatus, type EventInfo, type Series } from "@/lib/events";
import { EventMatchup } from "./event-matchup";

const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long", timeZone: "UTC" });

type ScheduleDetail = { tier: EventInfo["tier"]; initialNow: number };

function DetailScheduleRow({ match, tier, now }: { match: Series; tier: EventInfo["tier"]; now: number }) {
  const startsAt = seriesStartTime(match);
  const countdown = match.status === "scheduled" ? seriesCountdown(startsAt, now) : null;
  return <Link className="record-row event-detail-row" href={seriesHref(match)}>
    <span className="event-detail-time">
      {countdown ? <span role="timer" className="event-countdown mono" aria-label={countdown} title={`北京时间 ${timeLabel(startsAt)}`}>{countdown}</span>
        : <time className="record-date mono" dateTime={startsAt}>{timeLabel(startsAt)}</time>}
    </span>
    <span className="mono event-detail-format">(BO{match.best_of})</span>
    <EventMatchup series={match} showVersus />
    <span className="event-detail-status">
      <span className="event-status" data-status={match.status}>{seriesStatus[match.status]}</span>
      {match.maps.some((map) => map.replay_id) && <Clapperboard className="event-row-replays" size={15} aria-label="有回放" />}
    </span>
    <span className="event-detail-label">
      <Trophy size={19} aria-hidden="true" />
      <span className="event-detail-name">{match.event_name}{match.stage && <small>{match.stage}</small>}</span>
      {tier && <span className="event-tier mono" data-tier={tier} aria-label={`赛事评级 ${tier}`}>{tier}</span>}
    </span>
  </Link>;
}

export function EventSchedule({ series, events, detail }: { series: Series[]; events?: EventInfo[]; detail?: ScheduleDetail }) {
  const [day, setDay] = useState("");
  const [eventId, setEventId] = useState("");
  const [now, setNow] = useState(detail?.initialNow ?? 0);
  const isDetail = detail !== undefined;
  useEffect(() => {
    if (!isDetail) return;
    const lastStart = series.reduce((latest, match) => match.status === "scheduled"
      ? Math.max(latest, Date.parse(match.starts_at)) : latest, 0);
    const currentTime = Date.now();
    setNow(currentTime);
    if (lastStart <= currentTime) return;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= lastStart) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isDetail, series]);

  const groups = useMemo(() => {
    const grouped = new Map<string, Series[]>();
    const ordered = isDetail ? [...series].sort((a, b) => Date.parse(seriesStartTime(a)) - Date.parse(seriesStartTime(b))) : series;
    for (const match of ordered) {
      const date = dateKey(isDetail ? seriesStartTime(match) : match.starts_at);
      if ((day && day !== date) || (eventId && eventId !== match.event_id)) continue;
      const entries = grouped.get(date);
      if (entries) entries.push(match);
      else grouped.set(date, [match]);
    }
    return grouped;
  }, [day, eventId, isDetail, series]);
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
        {matches.map((match) => detail ? <DetailScheduleRow key={match.series_id} match={match} tier={detail.tier} now={now} />
          : <Link className="record-row event-row" key={match.series_id} href={seriesHref(match)}>
          <span className="event-row-time"><time className="record-date mono" dateTime={match.starts_at}>{timeLabel(match.starts_at)}</time>
            <span className="event-status" data-status={match.status}>{seriesStatus[match.status]}</span></span>
          <span className="mono event-format">BO{match.best_of}</span>
          <EventMatchup series={match} />
          <span className="event-row-replays">{match.maps.some((map) => map.replay_id) && <Clapperboard size={16} aria-label="有回放" />}</span>
          <span className="event-row-title">
            <Trophy size={18} aria-hidden="true" />
            <span>{match.event_name}{match.stage && <strong>{match.stage}</strong>}</span>
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
