"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminRequest, sessionCookie } from "./session";

async function errorMessage(response: Response | null, fallback: string): Promise<string> {
  if (!response) return "无法连接战绩服务";
  const data = await response.json().catch(() => null);
  return typeof data?.error === "string" ? data.error : fallback;
}

export async function signIn(_error: string, form: FormData) {
  const response = await adminRequest("/admin/session", {
    method: "POST",
    body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
  }).catch(() => null);
  if (!response?.ok) return errorMessage(response, "登录失败");
  const { token, max_age } = await response.json() as { token: string; max_age: number };
  const origin = (await headers()).get("origin");
  (await cookies()).set(sessionCookie, token, {
    httpOnly: true, secure: !origin?.startsWith("http://"), sameSite: "lax", path: "/admin", maxAge: max_age,
  });
  redirect("/admin");
}

export async function signOut() {
  const response = await adminRequest("/admin/session", { method: "DELETE" }).catch(() => null);
  if (response && ![204, 401, 503].includes(response.status)) throw new Error("Admin sign-out failed");
  (await cookies()).set(sessionCookie, "", { path: "/admin", maxAge: 0 });
  redirect("/admin");
}

export async function saveName(tab: "players" | "maps", id: string, _error: string, form: FormData) {
  const path = tab === "maps" ? "/admin/maps" : `/admin/players/${encodeURIComponent(id)}`;
  const response = await adminRequest(path, {
    method: "PATCH",
    body: JSON.stringify({ id, name: form.get("name") }),
  }).catch(() => null);
  if (response?.status === 401) redirect("/admin");
  if (!response?.ok) return errorMessage(response, "保存失败");
  revalidatePath("/", "layout");
  redirect(`/admin?tab=${tab}`);
}

export async function saveWeeklyPlayer(_error: string, form: FormData) {
  const selection = form.get("change") === "clear" ? null : {
    player_id: form.get("player_id"),
    reason: form.get("reason"),
    highlight: form.get("highlight"),
  };
  const response = await adminRequest("/admin/player-of-the-week", {
    method: "PUT",
    body: JSON.stringify(selection),
  }).catch(() => null);
  if (response?.status === 401) redirect("/admin");
  if (!response?.ok) return errorMessage(response, "每周最佳选手保存失败");
  revalidatePath("/");
  revalidatePath("/admin");
  redirect("/admin?tab=weekly");
}

export async function saveImage(tab: "players" | "maps" | "event-teams", id: string, _state: { error?: string; saved?: boolean }, form: FormData) {
  const image = form.get("image");
  if (!(image instanceof File) || !image.size) return { error: "请先选择图片" };
  if (image.size > 5 * 1024 * 1024) return { error: "图片大小不能超过 5 MB" };

  const response = await adminRequest(`/admin/${tab}/${encodeURIComponent(id)}/image`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: image,
  }).catch(() => null);
  if (response?.status === 401) redirect("/admin");
  if (!response?.ok) return { error: await errorMessage(response, "图片保存失败") };
  revalidatePath("/", "layout");
  return { saved: true };
}
