import { cookies } from "next/headers";
import { apiUrl } from "@/lib/api";

export const sessionCookie = "vltv_admin";

export async function adminRequest(path: string, init?: RequestInit, timeout = 8000) {
  const token = (await cookies()).get(sessionCookie)?.value;
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(apiUrl(path), {
    ...init, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeout),
  });
}
