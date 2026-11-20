"use client";

import { Upload } from "lucide-react";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { sendImport } from "@/components/import-form";
import { dateKey, matchTime, timeLabel, type MatchSummary } from "@/lib/archive";
import { mapInfo, type MapCatalog } from "@/lib/catalog";
import { eventTiers, vetoLabels, type EventPlacement, type EventTeam, type EventTier, type SeriesDetail } from "@/lib/events";
import { REPLAY_MAX_BYTES } from "@/lib/import-limits";

type Action = (error: string, form: FormData) => Promise<string>;

function useEventForm(action: Action) {
  const [error, dispatch, pending] = useActionState(action, "");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => dispatch(form));
  }
  return { error, pending, submit };
}

export function EventNameForm({ name, tag, tier, action }: {
  name?: string; tag?: string; tier?: EventTier | null; action: Action;
}) {
  const { error, pending, submit } = useEventForm(action);
  return <form className="admin-form" onSubmit={submit}>
    <label>名称<input name="name" maxLength={80} required defaultValue={name} /></label>
    {tag !== undefined && <label>简称<input name="tag" maxLength={16} required defaultValue={tag} /></label>}
    {tag === undefined && <label>赛事等级<select name="tier" defaultValue={tier ?? ""}>
      <option value="">未设置</option>
      {eventTiers.map((value) => <option key={value} value={value}>{value} 级</option>)}
    </select></label>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button className="button button-primary" disabled={pending}>保存</button>
  </form>;
}

export function EventPlacementForm({ teams, placements, action }: {
  teams: EventTeam[]; placements: EventPlacement[]; action: Action;
}) {
  const [teamId, setTeamId] = useState("");
  const { error, pending, submit } = useEventForm(action);
  const placement = placements.find((entry) => entry.team_id === teamId);
  const last = placement && placement.last_place !== placement.first_place ? placement.last_place : undefined;
  return <form className="admin-form" onSubmit={submit}>
    <label>战队<select name="team_id" required value={teamId} onChange={(event) => setTeamId(event.target.value)}>
      <option value="">请选择战队</option>
      {teams.map((team) => <option key={team.team_id} value={team.team_id}>{team.name} ({team.tag})</option>)}
    </select></label>
    <div className="event-admin-grid" key={`${teamId}:${placement?.first_place}:${last}`}>
      <label>名次<input name="first_place" type="number" min={1} step={1} defaultValue={placement?.first_place} /></label>
      <label>区间末位（可选）<input name="last_place" type="number" min={1} step={1} defaultValue={last} /></label>
    </div>
    <p className="admin-empty">清空两项并保存可移除该战队的名次。</p>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button className="button button-primary" disabled={pending || !teamId}>保存名次</button>
  </form>;
}

export function DeleteEventForm({ label, action }: { label: string; action: Action }) {
  const [error, dispatch, pending] = useActionState(action, "");
  return <form action={dispatch} className="admin-form" onSubmit={(event) => {
    if (!window.confirm(`确定${label}？`)) event.preventDefault();
  }}>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button className="button button-outline negative" disabled={pending}>{label}</button>
  </form>;
}

export function EventSeriesForm({ series, teams, replays, mapChoices, catalog, action }: {
  series?: SeriesDetail; teams: EventTeam[]; replays: MatchSummary[]; mapChoices: string[]; catalog: MapCatalog; action: Action;
}) {
  const { error, pending, submit } = useEventForm(action);
  const [bestOf, setBestOf] = useState<number>(series?.best_of ?? 3);
  const [selected, setSelected] = useState(() => series?.maps.map(({ replay_id }) => replay_id ?? "") ?? []);
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");

  function selectReplay(index: number, id: string) {
    setSelected((current) => Object.assign([...current], { [index]: id }));
  }

  async function uploadReplay(index: number, file?: File) {
    if (!file || uploading !== null || pending) return;
    setUploadError("");
    if (file.size === 0 || file.size > REPLAY_MAX_BYTES) {
      setUploadError("请选择 128 MiB 以内的非空回放");
      return;
    }
    setUploading(index);
    try {
      const receipt = await sendImport(file, "application/octet-stream");
      if (selected.some((id, slot) => id === receipt.match_id && slot !== index && slot < bestOf)) {
        setUploadError("该回放已在本场比赛的另一张地图中选用");
        return;
      }
      setUploaded((current) => ({ ...current, [receipt.match_id]: file.name }));
      selectReplay(index, receipt.match_id);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "回放导入失败");
    } finally {
      setUploading(null);
    }
  }

  const available = new Map(replays.map((replay) => [
    replay.match_id, `${dateKey(matchTime(replay))} ${timeLabel(matchTime(replay))} · ${mapInfo(replay.map_id, catalog).name} · ${replay.blue_score}:${replay.red_score} · ${replay.match_id.slice(0, 8)}`,
  ]));
  for (const entry of series?.maps ?? []) {
    if (entry.replay_id && entry.map_id) {
      available.set(entry.replay_id, `${mapInfo(entry.map_id, catalog).name} · ${entry.replay_id.slice(0, 8)}`);
    }
  }
  for (const [id, name] of Object.entries(uploaded)) if (!available.has(id)) available.set(id, name);

  const kickoff = series ? `${dateKey(series.starts_at)}T${timeLabel(series.starts_at)}` : undefined;
  return <form className="admin-form event-admin-form" onSubmit={(event) => {
    if (uploading !== null || pending) event.preventDefault();
    else submit(event);
  }}>
    <div className="event-admin-grid">
      <label>比赛时间（北京时间）<input type="datetime-local" name="starts_at" required defaultValue={kickoff} /></label>
      <label>阶段<input name="stage" maxLength={80} defaultValue={series?.stage ?? ""} /></label>
      {(["a", "b"] as const).map((side) => <label key={side}>战队 {side.toUpperCase()}
        <select name={`team_${side}`} required defaultValue={series?.[`team_${side}`].team_id ?? ""}>
          <option value="">选择战队</option>
          {teams.map((team) => <option value={team.team_id} key={team.team_id}>{team.tag} · {team.name}</option>)}
        </select>
      </label>)}
      <label>赛制<select name="best_of" value={bestOf} disabled={uploading !== null} onChange={(event) => setBestOf(Number(event.target.value))}>
        {[1, 3, 5].map((value) => <option value={value} key={value}>BO{value}</option>)}
      </select></label>
      <label className="event-admin-checkbox"><input name="live" type="checkbox" defaultChecked={series?.live} />进行中</label>
      <label>战队 A 总比分<input name="score_a" type="number" min={0} max={(bestOf + 1) / 2}
        placeholder="自动" defaultValue={series?.manual_score_a ?? ""} /></label>
      <label>战队 B 总比分<input name="score_b" type="number" min={0} max={(bestOf + 1) / 2}
        placeholder="自动" defaultValue={series?.manual_score_b ?? ""} /></label>
    </div>
    <datalist id="event-admin-maps">
      {mapChoices.map((code) => <option value={code} label={mapInfo(code, catalog).name} key={code} />)}
    </datalist>
    {Array.from({ length: 5 }, (_, index) => {
      const map = series?.maps[index];
      const hidden = index >= bestOf;
      return <fieldset className="event-admin-maps" hidden={hidden} key={index}>
        <legend>第 {index + 1} 图</legend>
        <div className="event-admin-grid">
          <label>地图<input name={`map_${index}`} list="event-admin-maps" maxLength={80}
            defaultValue={map?.planned_map_id ?? ""} /></label>
          <label>回放蓝方<select name={`side_${index}`} defaultValue={map?.a_is_blue === false ? "red" : "blue"}>
            <option value="blue">战队 A</option><option value="red">战队 B</option>
          </select></label>
          <label>回放<select name={`replay_${index}`} value={selected[index] ?? ""}
            onChange={(event) => selectReplay(index, event.target.value)}>
            <option value="">待添加</option>
            {[...available].map(([id, label]) => <option key={id} value={id}
              disabled={selected.some((entry, other) => entry === id && other !== index && other < bestOf)}>{label}</option>)}
          </select></label>
          <label className="button button-outline event-upload"><Upload size={16} />
            {uploading === index ? "正在导入…" : "导入回放"}
            <input type="file" accept=".vrf" aria-label={`导入第 ${index + 1} 图回放`} disabled={uploading !== null || pending}
              onChange={(event) => { void uploadReplay(index, event.target.files?.[0]); event.target.value = ""; }} />
          </label>
        </div>
      </fieldset>;
    })}
    <details className="event-admin-veto" open={series?.veto.length ? true : undefined}>
      <summary>选图记录</summary>
      {Array.from({ length: 7 }, (_, index) => <div className="event-admin-grid" key={index}>
        <select name={`veto_action_${index}`} aria-label={`选图记录 ${index + 1}`} defaultValue={series?.veto[index]?.action ?? ""}>
          <option value="">未填写</option>
          {Object.entries(vetoLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <input name={`veto_map_${index}`} aria-label={`选图地图 ${index + 1}`} list="event-admin-maps"
          placeholder="地图" maxLength={80} defaultValue={series?.veto[index]?.map_id ?? ""} />
      </div>)}
    </details>
    {(uploadError || error) && <p className="admin-error" role="alert">{uploadError || error}</p>}
    <button className="button button-primary" disabled={pending || uploading !== null}>保存比赛</button>
  </form>;
}
