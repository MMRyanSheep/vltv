import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { formatRating, ratingDescription, score, teamName, type MatchDetail, type MatchPlayer, type Team } from "@/lib/archive";
import { agent, playerName } from "@/lib/catalog";
import { AgentAvatar } from "./presentation";

function killDiff(player: MatchPlayer) {
  if (player.kill_diff != null) return player.kill_diff;
  if (player.kills == null || player.deaths == null) return "-";
  const diff = player.kills - player.deaths;
  return diff > 0 ? `+${diff}` : String(diff);
}

function decimalStat(value: number | null | undefined, suffix = "") {
  return value == null ? "-" : value.toFixed(1) + suffix;
}

export function Scoreboards({ match, teamNames, hideScore, agentIds }: {
  match: Pick<MatchDetail, "players" | "ssversion" | "rating_version" | "blue_score" | "red_score">;
  teamNames?: Record<Team, string>;
  hideScore?: boolean;
  agentIds?: Record<string, string[]>;
}) {
  const swingDescription = match.ssversion === "1.2"
    ? "每回合归因的胜率变化，单位为百分点。有伤害记录的正向击杀收益一半归击杀者，另一半按对受害者当前一条命的实际伤害分摊。"
    : "每回合归因的胜率变化，单位为百分点";
  return <div className="scoreboards" id="scoreboards">
      {(["Blue", "Red"] as Team[]).map((team) => {
        const tint = team.toLowerCase();
        const name = teamNames?.[team] ?? teamName(team);
        return <section className={`panel scoreboard ${tint}-panel`} key={team}>
          <div className="section-head">
            <h2><span className={`team-dot ${tint}`} />{name}</h2>
            {!hideScore && <strong className={`team-total mono ${tint}`}>{team === "Blue" ? match.blue_score : match.red_score}</strong>}
          </div>
          <div className="scoreboard-scroll" tabIndex={0} role="region" aria-label={`${name}选手统计`}>
            <table>
              <thead><tr>
                <th scope="col">选手</th>
                <th scope="col">击杀</th>
                <th scope="col">阵亡</th>
                <th scope="col">助攻</th>
                <th scope="col">击杀-阵亡</th>
                <th scope="col" title="回放记录的平均战斗分">ACS</th>
                <th scope="col" title="爆头命中率">HS%</th>
                <th scope="col" title="首杀">FK</th>
                <th scope="col" title="首死">FD</th>
                <th scope="col">KAST</th>
                <th scope="col" title="每回合平均对敌伤害">ADR</th>
                <th scope="col" title={swingDescription}>SwingScore{match.ssversion && ` v ${match.ssversion}`}</th>
                <th scope="col" title={ratingDescription}>Rating{match.rating_version && ` v${match.rating_version}`}</th>
              </tr></thead>
              <tbody>
                {match.players.filter((player) => player.team_id === team).map((player) => (
                  <tr key={player.player_id}>
                    <th scope="row"><Link href={`/players/${player.player_id}`} className="player-link" aria-label={`${playerName(player)} · ${agent(player.agent_id).name} · ${player.player_id.slice(0, 8)}`} title={agent(player.agent_id).name}>
                      <AgentAvatar id={player.agent_id} player={player} /><span>{playerName(player)}</span><ArrowUpRight size={13} />
                      {agentIds && <span className="scoreboard-agents">
                        {agentIds[player.player_id]?.map((id) => <AgentAvatar key={id} id={id} />)}
                      </span>}
                    </Link></th>
                    <td>{player.kills ?? "-"}</td>
                    <td>{player.deaths ?? "-"}</td>
                    <td>{player.assists ?? "-"}</td>
                    <td>{killDiff(player)}</td>
                    <td>{decimalStat(player.acs)}</td>
                    <td>{decimalStat(player.hs_percent, "%")}</td>
                    <td>{player.first_kills ?? "-"}</td>
                    <td>{player.first_deaths ?? "-"}</td>
                    <td>{decimalStat(player.kast, "%")}</td>
                    <td>{decimalStat(player.adr)}</td>
                    <td className={player.swingscore >= 0 ? "accent" : "negative"}>{score(player.swingscore)}</td>
                    <td>{formatRating(player.rating)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>;
      })}
    </div>;
}
