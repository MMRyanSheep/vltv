"use client";

import { Check, ChevronRight, UserRound } from "lucide-react";
import { useActionState, useState } from "react";
import { score } from "@/lib/archive";
import type { WeeklyCategory, WeeklyReview } from "@/lib/weekly-player";
import { saveWeeklyPlayer } from "./actions";
import type { Entry } from "./controls";

const categories: {
  id: WeeklyCategory; label: string; metric: string; description: string; format: (value: number) => string;
}[] = [
  { id: "impact", label: "回合影响", metric: "SwingScore",
    description: "按回合数加权的平均 SwingScore，衡量选手对回合胜率的影响。", format: score },
  { id: "damage", label: "输出伤害", metric: "ADR",
    description: "每回合对敌伤害，按回合数加权。", format: (value) => value.toFixed(1) },
  { id: "opening", label: "首杀", metric: "首杀 / 100 回合",
    description: "每 100 回合拿到的首杀次数。", format: (value) => value.toFixed(1) },
  { id: "assists", label: "助攻", metric: "助攻 / 回合",
    description: "有助攻记录的比赛中，平均每回合的助攻次数。", format: (value) => value.toFixed(2) },
  { id: "participation", label: "回合参与度", metric: "KAST",
    description: "有击杀、助攻、存活或被队友补枪的回合占比。", format: (value) => `${value.toFixed(1)}%` },
];

export function WeeklyPlayerReview({ players, weekly }: { players: Entry[]; weekly: WeeklyReview }) {
  const { selection, stats, week_start } = weekly;
  const [category, setCategory] = useState(categories[0]);
  const [error, submit, pending] = useActionState(saveWeeklyPlayer, "");
  const [playerId, setPlayerId] = useState(selection?.player_id ?? "");
  const [reason, setReason] = useState(selection?.reason ?? "");
  const [highlight, setHighlight] = useState(selection?.highlight ?? "");
  const playersById = new Map(players.map((player) => [player.id, player]));
  const candidates = stats.candidates[category.id] ?? [];
  const weekEnd = new Date(`${week_start}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  return <>
    <header className="weekly-review-header">
      <h2>每周最佳选手</h2>
      <p className="admin-hint">
        <span className="mono">{week_start} — {weekEnd.toISOString().slice(0, 10)}</span>
        {" · 北京时间归档 · "}{stats.match_count} 场 · {stats.round_count} 回合
      </p>
    </header>
    <div className="weekly-review">
      <section className="weekly-review-candidates" aria-labelledby="weekly-candidates-title">
        <h3 id="weekly-candidates-title">本周候选</h3>
        {stats.match_count > 0 ? <>
          <p className="admin-hint">本周至少出场 2 场的选手才会进入推荐统计。</p>
          <div className="weekly-review-filters" role="group" aria-label="评选领域">
            {categories.map((item) => <button key={item.id} type="button" className="filter-button"
              aria-pressed={item.id === category.id} onClick={() => setCategory(item)}>{item.label}</button>)}
          </div>
          <p className="admin-hint">{category.description}</p>
          {candidates.length ? <ol className="weekly-review-list" aria-label={`${category.label}候选`}>
            {candidates.map((candidate, index) => {
              const { player_id, value, match_count, round_count } = candidate;
              const player = playersById.get(player_id);
              const name = player?.name ?? player?.fallback ?? "选手";
              const formatted = category.format(value);
              const suggestion = `本周${category.label}第 ${index + 1} 名 · ${category.metric}`;
              const filled = playerId === player_id && reason === suggestion && highlight === formatted;
              return <li key={player_id}>
                <button className="weekly-review-candidate" type="button" disabled={pending}
                  aria-pressed={filled} onClick={() => {
                    setPlayerId(player_id);
                    setReason(suggestion);
                    setHighlight(formatted);
                  }}>
                  <span className="weekly-review-rank mono">{index + 1}</span>
                  <span className="agent-avatar" aria-hidden="true">
                    {player?.image ? <img src={player.image} alt="" width={40} height={40} /> : <UserRound size={19} />}
                  </span>
                  <span className="weekly-review-identity">
                    <strong>{name}</strong>
                    <small>#{player_id.slice(0, 8)} · 指标覆盖 {match_count} 场 · {round_count} 回合</small>
                  </span>
                  <span className="weekly-review-value">
                    <strong className="mono">{formatted}</strong>
                    <small>{category.metric}</small>
                  </span>
                  <span className="weekly-review-fill">
                    {filled ? <>已填入<Check size={14} aria-hidden="true" /></> :
                      <>填入<ChevronRight size={14} aria-hidden="true" /></>}
                  </span>
                </button>
              </li>;
            })}
          </ol> : <p className="weekly-review-empty">本周暂无该领域的候选选手。</p>}
        </> : <p className="weekly-review-empty">本周暂无已归档的比赛。</p>}
      </section>

      <section className="weekly-review-publish" aria-labelledby="weekly-publish-title">
        <div className="weekly-review-publish-heading">
          <h3 id="weekly-publish-title">首页发布</h3>
          <span className={selection ? "accent" : "admin-hint"}>{selection ? "已发布" : "未发布"}</span>
        </div>
        <form action={submit} className="admin-form">
          <div className="admin-form-field">
            <label htmlFor="weekly-player">选手</label>
            <select id="weekly-player" name="player_id" required value={playerId} disabled={pending}
              onChange={(event) => setPlayerId(event.target.value)}>
              <option value="" disabled>{players.length ? "选择已归档的选手" : "暂无已归档的选手"}</option>
              {playerId && !playersById.has(playerId) &&
                <option value={playerId}>选手 · #{playerId.slice(0, 8)}</option>}
              {players.map(({ id, name, fallback }) =>
                <option key={id} value={id}>{name ?? fallback} · #{id.slice(0, 8)}</option>)}
            </select>
          </div>
          <label>上榜原因<input name="reason" required maxLength={120} value={reason}
            disabled={pending} onChange={(event) => setReason(event.target.value)} /></label>
          <label>高亮数据（可选）<input name="highlight" maxLength={12} value={highlight}
            disabled={pending} onChange={(event) => setHighlight(event.target.value)} /></label>
          <p className="admin-hint">立绘优先使用该选手本周出场最多的英雄。</p>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="admin-form-buttons">
            <button className="button button-primary" disabled={pending || !playerId || !reason.trim()}>
              {selection ? "保存修改" : "发布到首页"}
            </button>
            {selection && <button className="button button-outline" name="change" value="clear" formNoValidate
              disabled={pending}>撤下本周评选</button>}
          </div>
        </form>
      </section>
    </div>
  </>;
}
