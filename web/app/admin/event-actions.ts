"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminRequest } from "./session";

const root = "/admin?tab=events";
const eventPath = (id: string) => `/admin/events/${encodeURIComponent(id)}`;
const teamPath = (id: string) => `/admin/event-teams/${encodeURIComponent(id)}`;

async function mutate(path: string, method: string, data?: unknown) {
  const response = await adminRequest(path, { method, body: data === undefined ? undefined : JSON.stringify(data) })
    .catch(() => null);
  if (response?.status === 401) redirect("/admin");
  if (!response) return { error: "无法连接战绩服务" };
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    return { error: typeof result?.error === "string" ? result.error : "保存失败，请检查填写内容" };
  }
  revalidatePath("/", "layout");
  const id = response.status === 204 ? undefined : await response.json() as string;
  return { id };
}

export async function saveEvent(id: string | null, _error: string, form: FormData) {
  const result = await mutate(id ? eventPath(id) : "/admin/events", id ? "PUT" : "POST", {
    name: form.get("name"), tier: form.get("tier") || null,
  });
  if (result.error) return result.error;
  redirect(`${root}&event=${encodeURIComponent(id ?? result.id!)}`);
}

export async function savePlacement(eventId: string, _error: string, form: FormData) {
  const teamId = String(form.get("team_id") ?? "");
  if (!teamId) return "请选择战队";
  const first = String(form.get("first_place") ?? "");
  const last = String(form.get("last_place") ?? "");
  const valid = (value: string) => !value || (/^[1-9]\d*$/.test(value) && Number(value) <= 2147483647);
  if (!valid(first) || !valid(last) || (last && (!first || Number(last) < Number(first)))) {
    return "请输入有效的名次或名次区间";
  }
  const result = await mutate(`${eventPath(eventId)}/placements/${encodeURIComponent(teamId)}`, "PUT", {
    first_place: first ? Number(first) : null, last_place: last ? Number(last) : null,
  });
  if (result.error) return result.error;
  redirect(`${root}&event=${encodeURIComponent(eventId)}`);
}

export async function saveTeam(id: string | null, _error: string, form: FormData) {
  const result = await mutate(id ? teamPath(id) : "/admin/event-teams", id ? "PUT" : "POST", {
    name: form.get("name"), tag: form.get("tag"),
  });
  if (result.error) return result.error;
  redirect(`${root}&team=${encodeURIComponent(id ?? result.id!)}`);
}

export async function saveSeries(eventId: string, id: string | null, _error: string, form: FormData) {
  const bestOf = Number(form.get("best_of"));
  const startsAt = String(form.get("starts_at"));
  if (![1, 3, 5].includes(bestOf)) return "请选择赛制";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAt)) return "请输入比赛时间";
  const maps = Array.from({ length: bestOf }, (_, index) => ({
    map_id: String(form.get(`map_${index}`) ?? "").trim() || null,
    replay_id: form.get(`replay_${index}`) || null,
    a_is_blue: form.get(`side_${index}`) === "blue",
  }));
  const veto = Array.from({ length: 7 }, (_, index) => ({
    action: form.get(`veto_action_${index}`),
    map_id: String(form.get(`veto_map_${index}`) ?? "").trim(),
  })).filter(({ action, map_id }) => action || map_id);
  if (veto.some(({ action, map_id }) => !action || !map_id)) return "请填写完整的选图记录";
  const paths = `${eventPath(eventId)}/matches`;
  const result = await mutate(id ? `${paths}/${encodeURIComponent(id)}` : paths, id ? "PUT" : "POST", {
    starts_at: `${startsAt}:00+08:00`,
    stage: String(form.get("stage") ?? "").trim() || null,
    best_of: bestOf,
    team_a: form.get("team_a"),
    team_b: form.get("team_b"),
    live: form.has("live"),
    score_a: form.get("score_a") ? Number(form.get("score_a")) : null,
    score_b: form.get("score_b") ? Number(form.get("score_b")) : null,
    maps, veto,
  });
  if (result.error) return result.error;
  redirect(`${root}&event=${encodeURIComponent(eventId)}`);
}

export async function deleteEventRecord(kind: "event" | "team" | "series", id: string, eventId: string | null) {
  if (kind === "series" && !eventId) return "找不到所属赛事";
  const path = kind === "team" ? teamPath(id) : kind === "event" ? eventPath(id)
    : `${eventPath(eventId!)}/matches/${encodeURIComponent(id)}`;
  const result = await mutate(path, "DELETE");
  if (result.error) return result.error;
  redirect(kind === "team" ? `${root}&teams=1` : kind === "series" ? `${root}&event=${encodeURIComponent(eventId!)}` : root);
}
