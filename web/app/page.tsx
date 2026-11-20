import { ChevronRight, Flame, Radio } from "lucide-react";
import Link from "next/link";
import { MapDistribution } from "@/components/map-distribution";
import { Records } from "@/components/records";
import { AgentAvatar, MapThumbnail } from "@/components/presentation";
import { PlayerOfTheWeek } from "@/components/weekly-player";
import { readArchive, readMapCatalog } from "@/lib/api";
import { dateKey, score, type Overview } from "@/lib/archive";
import { mapInfo, playerName, type ArchiveMap } from "@/lib/catalog";
import type { WeeklyPlayer } from "@/lib/weekly-player";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { view } = await searchParams;
  const showPlayers = view === "players";
  const [data, mapCatalog, weekly] = await Promise.all([
    readArchive<Overview>("/overview"), readMapCatalog(),
    showPlayers ? null : readArchive<WeeklyPlayer>("/player-of-the-week"),
  ]);
  const today = dateKey(new Date().toISOString());
  const latest = data.matches[0];
  const counts = new Map<string, ArchiveMap>();
  for (const match of data.matches) {
    const { code, name } = mapInfo(match.map_id, mapCatalog);
    const entry = counts.get(code);
    if (entry) entry.count += 1;
    else counts.set(code, { code, name, count: 1 });
  }
  const maps = [...counts.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  return <>
    <div className={showPlayers ? "player-index" : "dashboard"}>
      <div className="dashboard-main">
        <div className="page-heading archive-heading panel">
          <h1 className="page-title">{showPlayers ? "选手索引" : "战绩档案"}</h1>
          {!showPlayers && <dl className="archive-totals">
            <div><dt>比赛</dt><dd>{data.matches.length.toLocaleString("zh-CN")}</dd></div>
            <div><dt>选手</dt><dd>{data.profiles.length.toLocaleString("zh-CN")}</dd></div>
            <div><dt>回合</dt><dd>{data.round_count.toLocaleString("zh-CN")}</dd></div>
          </dl>}
        </div>
        <Records key={showPlayers ? "players" : "matches"} matches={data.matches}
          profiles={data.profiles} maps={maps} mapCatalog={mapCatalog} showPlayers={showPlayers} today={today} />
      </div>
      {!showPlayers && <aside className="dashboard-side" aria-label="档案统计">
        <PlayerOfTheWeek selection={weekly?.selection ?? null} />
        <section className="panel leaderboard">
          <div className="section-head"><h2><Flame size={16} className="hot" aria-hidden="true" />单场 SwingScore 榜</h2></div>
          {data.leaders.length === 0 && <p className="empty-inline">导入比赛后显示榜单。</p>}
          {data.leaders.map((leader, index) => (
            <Link className="leader" key={leader.player_id} href={`/players/${leader.player_id}`}>
              <span className="ordinal">{String(index + 1).padStart(2, "0")}</span>
              <AgentAvatar id={leader.agent_id} player={leader} />
              <span className="identity"><strong>{playerName(leader)}</strong><small>{mapInfo(leader.map_id, mapCatalog).name}</small></span>
              <span className="mono accent leader-score">{score(leader.swingscore)}</span>
              <ChevronRight size={14} className="subtle" aria-hidden="true" />
            </Link>
          ))}
        </section>
        <section className="panel broadcasts">
          <div className="section-head">
            <h2><Radio size={16} className="accent" aria-hidden="true" />直播与回放</h2>
            <span className="status-tag">暂无直播</span>
          </div>
          {latest ? <Link href={`/matches/${latest.match_id}`} className="broadcast-entry">
            <MapThumbnail id={latest.map_id} catalog={mapCatalog} />
            <span className="identity"><strong>{mapInfo(latest.map_id, mapCatalog).name}</strong><small>最近归档</small></span>
            <ChevronRight size={14} className="subtle" aria-hidden="true" />
          </Link> : <p className="empty-inline">暂无回放。</p>}
        </section>
        <MapDistribution maps={maps} total={data.matches.length} />
      </aside>}
    </div>
  </>;
}
