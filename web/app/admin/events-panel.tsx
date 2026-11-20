import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readArchive, readMapCatalog } from "@/lib/api";
import { dateLabel, timeLabel } from "@/lib/archive";
import { catalogImage, mapCodes, mapInfo } from "@/lib/catalog";
import { eventHref, seriesHref, teamHref, type EventDetail, type EventManagement, type SeriesDetail } from "@/lib/events";
import { saveImage } from "./actions";
import { ImageForm } from "./controls";
import { deleteEventRecord, saveEvent, savePlacement, saveSeries, saveTeam } from "./event-actions";
import { DeleteEventForm, EventNameForm, EventPlacementForm, EventSeriesForm } from "./event-forms";

const root = "/admin?tab=events";
const teamList = `${root}&teams=1`;

function Back({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="admin-back"><ArrowLeft size={15} aria-hidden="true" />{children}</Link>;
}

export async function EventsPanel({ data, query }: {
  data: EventManagement; query: Awaited<PageProps<"/admin">["searchParams"]>;
}) {
  const { event, team, teams, series } = query;
  if (typeof team === "string") {
    const selected = data.teams.find((entry) => entry.team_id === team);
    if (team !== "new" && !selected) notFound();
    const id = selected?.team_id;
    return <>
      <Back href={teamList}>战队管理</Back>
      <div className="event-admin-heading">
        <h2>{selected?.name ?? "创建战队"}</h2>
        {selected && <Link className="button button-outline" href={teamHref(selected.team_id)}>查看战队</Link>}
      </div>
      <EventNameForm key={team} name={selected?.name} tag={selected?.tag ?? ""} action={saveTeam.bind(null, id ?? null)} />
      {selected && <>
        <ImageForm key={selected.team_id} label="战队队徽" hideHint
          image={selected.logo_version ? catalogImage("event-teams", selected.team_id, selected.logo_version) : undefined}
          action={saveImage.bind(null, "event-teams", selected.team_id)} />
        <DeleteEventForm label="删除战队" action={deleteEventRecord.bind(null, "team", selected.team_id, null)} />
      </>}
    </>;
  }
  if (teams === "1") {
    return <>
      <Back href={root}>赛事管理</Back>
      <div className="event-admin-heading"><h2>战队</h2>
        <Link className="button button-primary" href={`${root}&team=new`}><Plus size={16} />创建战队</Link>
      </div>
      {data.teams.length ? <ul className="admin-list">
        {data.teams.map((entry) => <li key={entry.team_id}>
          <Link href={`${root}&team=${entry.team_id}`}><span>{entry.name}</span><strong>{entry.tag}</strong><ChevronRight size={16} /></Link>
        </li>)}
      </ul> : <p className="admin-empty">暂无战队</p>}
    </>;
  }
  if (event === "new") {
    return <>
      <Back href={root}>赛事管理</Back>
      <h2>创建赛事</h2><EventNameForm action={saveEvent.bind(null, null)} />
    </>;
  }
  if (typeof event === "string") {
    const detail = await readArchive<EventDetail>(eventHref(event));
    const id = detail.event_id;
    const href = `${root}&event=${id}`;
    if (typeof series === "string") {
      const [match, catalog] = await Promise.all([
        series === "new" ? undefined : readArchive<SeriesDetail>(seriesHref({ event_id: id, series_id: series })),
        readMapCatalog(),
      ]);
      const canSchedule = data.teams.length >= 2;
      return <>
        <Back href={href}>{detail.name}</Back>
        <h2>{match ? `${match.team_a.tag} : ${match.team_b.tag}` : "添加比赛"}</h2>
        {canSchedule ? <EventSeriesForm key={series} series={match} teams={data.teams} replays={data.replays} catalog={catalog}
          mapChoices={[...new Set([...mapCodes, ...Object.keys(catalog).map((key) => mapInfo(key, catalog).code)])]}
          action={saveSeries.bind(null, id, match?.series_id ?? null)} />
          : <Link className="button button-primary event-admin-add-team" href={teamList}>添加参赛战队</Link>}
        {match && <DeleteEventForm label="删除比赛" action={deleteEventRecord.bind(null, "series", match.series_id, id)} />}
      </>;
    }
    return <>
      <Back href={root}>赛事管理</Back>
      <div className="event-admin-heading"><h2>{detail.name}</h2>
        <Link className="button button-outline" href={eventHref(id)}>查看赛事</Link>
      </div>
      <EventNameForm key={id} name={detail.name} tier={detail.tier} action={saveEvent.bind(null, id)} />
      {data.teams.length > 0 && <section className="event-admin-section">
        <div className="event-admin-heading"><h2>赛事名次</h2></div>
        <EventPlacementForm key={id} teams={data.teams} placements={detail.placements} action={savePlacement.bind(null, id)} />
      </section>}
      <section className="event-admin-section">
        <div className="event-admin-heading"><h2>比赛</h2>
          <Link className="button button-primary" href={`${href}&series=new`}><Plus size={16} />添加比赛</Link>
        </div>
        {detail.series.length ? <ul className="admin-list">
          {detail.series.map((match) => <li key={match.series_id}>
            <Link href={`${href}&series=${match.series_id}`}>
              <span>{match.team_a.tag} {match.status === "scheduled" ? "—" : `${match.score_a}:${match.score_b}`} {match.team_b.tag} · BO{match.best_of}{match.stage && ` · ${match.stage}`}</span>
              <time className="mono" dateTime={match.starts_at}>{dateLabel(match.starts_at)} {timeLabel(match.starts_at)}</time>
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </li>)}
        </ul> : <p className="admin-empty">暂无比赛</p>}
      </section>
      <DeleteEventForm label="删除赛事及其比赛" action={deleteEventRecord.bind(null, "event", id, null)} />
    </>;
  }
  return <>
    <div className="event-admin-heading"><h2>赛事</h2>
      <div className="admin-form-buttons">
        <Link className="button button-outline" href={teamList}>战队管理</Link>
        <Link className="button button-primary" href={`${root}&event=new`}><Plus size={16} />创建赛事</Link>
      </div>
    </div>
    {data.events.length ? <ul className="admin-list">
      {data.events.map((entry) => <li key={entry.event_id}>
        <Link href={`${root}&event=${entry.event_id}`}><span>{entry.name}</span><span /><ChevronRight size={16} /></Link>
      </li>)}
    </ul> : <p className="admin-empty">暂无赛事</p>}
  </>;
}
