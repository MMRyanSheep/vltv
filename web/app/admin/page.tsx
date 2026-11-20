import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { ImportForm } from "@/components/import-form";
import { readMapCatalog } from "@/lib/api";
import { agent, catalogImage, mapCodes, mapInfo } from "@/lib/catalog";
import type { WeeklyReview } from "@/lib/weekly-player";
import { saveImage, saveName, signOut } from "./actions";
import { Entries, ImageForm, Login, NameForm, type Entry } from "./controls";
import { EventsPanel } from "./events-panel";
import type { EventManagement } from "@/lib/events";
import { adminRequest, sessionCookie } from "./session";
import { WeeklyPlayerReview } from "./weekly-player-review";
import "./admin.css";

export const metadata = { title: "管理" };

const tabs = [
  { id: "players", label: "选手" },
  { id: "maps", label: "地图" },
  { id: "weekly", label: "每周最佳选手" },
  { id: "events", label: "赛事" },
  { id: "import", label: "导入比赛" },
] as const;

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  if (!(await cookies()).has(sessionCookie)) return <Login />;

  const query = await searchParams;
  const { tab, edit } = query;
  const section = tabs.find(({ id }) => id === tab) ?? tabs[0];
  const href = `/admin?tab=${section.id}`;
  const needsPlayers = section.id === "players" || section.id === "weekly";
  const [response, weeklyResponse] = await Promise.all([
    adminRequest(needsPlayers ? "/admin/players" : section.id === "events" ? "/admin/events" : "/admin/session"),
    section.id === "weekly" ? adminRequest("/admin/player-of-the-week") : null,
  ]);
  if (response.status === 401 || response.status === 503) return <Login />;
  if (!response.ok) throw new Error("Admin API request failed");
  if (weeklyResponse?.status === 401 || weeklyResponse?.status === 503) return <Login />;
  if (weeklyResponse && !weeklyResponse.ok) throw new Error("Weekly candidates request failed");
  const weekly: WeeklyReview | null = weeklyResponse ? await weeklyResponse.json() : null;
  const events: EventManagement | null = section.id === "events" ? await response.json() : null;

  let entries: Entry[] = [];
  if (needsPlayers) {
    const players = await response.json() as {
      player_id: string; agent_id: string | null; display_name: string | null; avatar_version: string | null;
    }[];
    entries = players.filter(({ agent_id }) => section.id === "players" || agent_id).map(({
      player_id, agent_id, display_name, avatar_version,
    }) => {
      const hero = agent_id ? agent(agent_id) : undefined;
      return {
        id: player_id, name: display_name, fallback: hero?.name ?? "选手",
        image: avatar_version ? catalogImage("players", player_id, avatar_version) : hero?.image,
      };
    });
  } else if (section.id === "maps") {
    const catalog = await readMapCatalog();
    const codes = new Set([...mapCodes, ...Object.keys(catalog).map((id) => mapInfo(id).code)]);
    entries = [...codes].sort().map((id) => ({
      id, name: Object.hasOwn(catalog, id) ? catalog[id].display_name : null,
      fallback: mapInfo(id).name, image: mapInfo(id, catalog).image,
    }));
  }
  const selected = entries.find(({ id }) => id === edit);

  return <div className="admin">
    <div className="page-heading">
      <h1 className="page-title">档案管理</h1>
      <form action={signOut}><button className="button button-outline">退出登录</button></form>
    </div>
    <section className="panel">
      <nav className="records-tabs" aria-label="管理导航">
        {tabs.map(({ id, label }) => <Link key={id} href={`/admin?tab=${id}`}
          aria-current={section.id === id ? "page" : undefined}>{label}</Link>)}
      </nav>
      <div className="admin-content">
        {section.id === "import" ? <ImportForm /> : events ? <EventsPanel data={events} query={query} /> : weekly ?
          <WeeklyPlayerReview key={JSON.stringify([weekly.week_start, weekly.selection])} players={entries} weekly={weekly} />
        : selected && (section.id === "players" || section.id === "maps") ? <>
          <Link href={href} className="admin-back"><ArrowLeft size={15} aria-hidden="true" />{section.label}</Link>
          <h2>{selected.name ?? selected.fallback}</h2>
          <p className="admin-id">{selected.id}</p>
          <NameForm key={selected.id} entry={selected} action={saveName.bind(null, section.id, selected.id)} />
          <ImageForm key={`image-${selected.id}`} label={section.id === "players" ? "选手头像" : "地图照片"}
            image={selected.image} action={saveImage.bind(null, section.id, selected.id)} />
        </> : <>
          <h2>{section.label}</h2>
          <Entries key={section.id} entries={entries} href={href} />
        </>}
      </div>
    </section>
  </div>;
}
