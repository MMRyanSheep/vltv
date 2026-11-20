import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { EventSchedule } from "@/components/event-schedule";
import { readArchive } from "@/lib/api";
import { eventHref, type EventDetail } from "@/lib/events";
import "../events.css";

export const metadata = { title: "赛事详情" };

export default async function EventPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const event = await readArchive<EventDetail>(eventHref(id));
  return <>
    <div className="breadcrumbs"><Link href="/events"><ArrowLeft size={16} />赛事</Link></div>
    <div className="page-heading archive-heading panel event-heading"><h1 className="page-title">{event.name}</h1></div>
    <EventSchedule series={event.series} detail={{ tier: event.tier, initialNow: Date.now() }} />
  </>;
}
