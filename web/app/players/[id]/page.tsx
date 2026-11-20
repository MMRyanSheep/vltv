import { ArrowLeft, ChartNoAxesColumnIncreasing, Crosshair, Trophy, Zap } from "lucide-react";
import Link from "next/link";
import { AgentAvatar } from "@/components/presentation";
import { PlayerStats } from "@/components/player-stats";
import { readArchive, readMapCatalog } from "@/lib/api";
import { averageRating, dateKey, dateLabel, formatRating, matchTime, resultFor, score, type Profile } from "@/lib/archive";
import { agent, mapInfo, playerName } from "@/lib/catalog";
import "../../events/events.css";

export const metadata = { title: "选手主页" };

export default async function ProfilePage({ params }: PageProps<"/players/[id]">) {
  const { id } = await params;
  const [profile, mapCatalog] = await Promise.all([
    readArchive<Profile>(`/players/${encodeURIComponent(id)}`), readMapCatalog(),
  ]);
  const latest = profile.matches[0];
  const hero = agent(latest?.agent_id ?? "");
  const wins = profile.matches.filter((match) => resultFor(match) === "胜利").length;
  const completed = profile.matches.filter((match) => resultFor(match) !== "未完赛").length;
  const total = profile.matches.reduce((acc, match) => ({
    swing: acc.swing + match.swingscore * match.round_count,
    rounds: acc.rounds + match.round_count,
  }), { swing: 0, rounds: 0 });
  const stats = [
    { label: "归档场次", value: profile.matches.length, icon: Crosshair },
    { label: "胜率", value: completed ? `${Math.round(wins / completed * 100)}%` : "—", icon: Trophy },
    { label: "平均 Rating", value: formatRating(averageRating(profile.matches)), icon: ChartNoAxesColumnIncreasing },
    { label: "平均 SwingScore", value: total.rounds ? score(total.swing / total.rounds) : "—", icon: Zap },
  ];
  return <>
    <div className="breadcrumbs"><Link href="/?view=players#matches"><ArrowLeft size={16} /> 选手索引</Link></div>
    <section className="hero profile-hero">
      <div className="hero-content profile-identity">
        <AgentAvatar id={latest?.agent_id ?? ""} player={profile} />
        <div>
          <h1>{playerName({ ...profile, agent_id: latest?.agent_id ?? "" })}</h1>
          <p className="profile-meta" title={profile.player_id}><span className="mono">#{profile.player_id.slice(0, 8)}</span>
            {latest && <> · 最近使用 {hero.name}</>}</p>
        </div>
      </div>
    </section>
    <div className="detail-strip">
      <nav aria-label="选手主页导航">
        <a href="#player-summary">选手概况</a>
        <a href="#player-agents">特工数据</a>
        <a href="#player-matches">比赛数据</a>
      </nav>
    </div>
    {profile.matches.length > 0 && <section className="panel recent-panel" id="player-summary" aria-labelledby="recent-title">
      <div className="section-head"><h2 id="recent-title">近期战绩</h2></div>
      <div className="form-strip">
        {profile.matches.slice(0, 10).map((match) => {
          const outcome = resultFor(match);
          const info = mapInfo(match.map_id, mapCatalog);
          return <Link className="result-tile" data-result={outcome} key={match.match_id} href={`/matches/${match.match_id}`}
            aria-label={`${info.name}，${outcome}，${match.played_at ? "比赛日期" : "导入日期"} ${dateLabel(matchTime(match))}`}>
            <strong>{outcome}</strong><small>{info.name}</small>
          </Link>;
        })}
      </div>
    </section>}
    <section className="stat-grid" id={profile.matches.length === 0 ? "player-summary" : undefined} aria-label="选手统计">
      {stats.map(({ label, value, icon: Icon }) => <div className="stat-card" key={label}>
        <span className="icon-tile"><Icon size={21} strokeWidth={1.7} /></span><div><span className="stat-label">{label}</span><strong>{value}</strong></div>
      </div>)}
    </section>
    <PlayerStats key={id} matches={profile.matches} series={profile.series} mapCatalog={mapCatalog} today={dateKey(new Date().toISOString())} />
  </>;
}
