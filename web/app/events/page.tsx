import { EventSchedule } from "@/components/event-schedule";
import { readArchive } from "@/lib/api";
import type { EventSchedule as Schedule } from "@/lib/events";
import "./events.css";

export const metadata = { title: "赛事" };

export default async function EventsPage() {
  const { events, series } = await readArchive<Schedule>("/events");
  return <>
    <div className="page-heading archive-heading panel event-heading"><h1 className="page-title">赛事</h1></div>
    <EventSchedule series={series} events={events} initialNow={Date.now()} />
  </>;
}
