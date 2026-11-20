import { ArrowLeft, CalendarDays } from "lucide-react";
import Link from "next/link";
import { MatchRadar } from "@/components/match-radar";
import { MapThumbnail, MatchScore } from "@/components/presentation";
import { Scoreboards } from "@/components/scoreboards";
import { RoundExplorer } from "@/components/round-explorer";
import { readArchive, readMapCatalog } from "@/lib/api";
import { dateLabel, matchTime, timeLabel, type MatchDetail } from "@/lib/archive";
import { mapInfo } from "@/lib/catalog";

export const metadata = { title: "比赛详情" };

export default async function MatchPage({ params }: PageProps<"/matches/[id]">) {
  const { id } = await params;
  const [match, mapCatalog] = await Promise.all([
    readArchive<MatchDetail>(`/matches/${encodeURIComponent(id)}`), readMapCatalog(),
  ]);
  const map = mapInfo(match.map_id, mapCatalog);
  return <>
    <div className="breadcrumbs"><Link href="/?view=matches#matches"><ArrowLeft size={16} /> 比赛记录</Link></div>
    <section className="hero detail-hero">
      <MapThumbnail id={match.map_id} catalog={mapCatalog} />
      <div className="hero-content">
        <p className="hero-kicker">{map.code}</p>
        <h1>{map.name}</h1>
        <p>{match.round_count} 回合 · v{match.patch_version}</p>
      </div>
      <div className="score-block"><div><span className="blue">蓝方</span><span className="red">红方</span></div><MatchScore match={match} /></div>
    </section>
    <div className="detail-strip">
      <nav aria-label="比赛详情导航">
        <a href="#scoreboards">比赛数据</a>
        {match.rounds.length > 0 && <a href="#rounds">回合事件</a>}
        <a href="#radar">选手雷达图</a>
      </nav>
      <time dateTime={matchTime(match)}><CalendarDays size={15} aria-hidden="true" />
        {match.played_at ? "比赛时间" : "导入时间"} {dateLabel(matchTime(match))} {timeLabel(matchTime(match))}
      </time>
    </div>

    <Scoreboards match={match} />
    {match.rounds.length > 0 && <RoundExplorer key={id} rounds={match.rounds} players={match.players} />}
    <MatchRadar key={id} players={match.players} rounds={match.rounds} roundCount={match.round_count} />
  </>;
}
