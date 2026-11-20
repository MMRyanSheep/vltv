import { MapPinned, UserRound } from "lucide-react";
import { agent, catalogImage, mapInfo, type MapCatalog } from "@/lib/catalog";
import type { MatchSummary } from "@/lib/archive";

export function AgentAvatar({ id, player }: {
  id: string; player?: { player_id: string; avatar_version?: string | null };
}) {
  const image = player?.avatar_version ? catalogImage("players", player.player_id, player.avatar_version) : agent(id).image;
  return <span className="agent-avatar" aria-hidden="true">
    {image ? <img src={image} alt="" width={40} height={40} /> : <UserRound size={19} />}
  </span>;
}

export function MapThumbnail({ id, catalog }: { id: string; catalog: MapCatalog }) {
  const map = mapInfo(id, catalog);
  return <span className="map-thumbnail" aria-hidden="true">
    {map.image ? <img src={map.image} alt="" width={78} height={48} /> : <MapPinned size={19} />}
  </span>;
}

export function MatchScore({ match }: { match: MatchSummary }) {
  return <span className="match-score" aria-label={`蓝方 ${match.blue_score} 比 红方 ${match.red_score}`}>
    <span className="blue" data-trailing={match.blue_score < match.red_score}>{match.blue_score}</span>
    <i>:</i>
    <span className="red" data-trailing={match.red_score < match.blue_score}>{match.red_score}</span>
  </span>;
}
