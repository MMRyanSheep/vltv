import { apiUrl } from "@/lib/api";

export async function GET(_request: Request, { params }: RouteContext<"/media/[kind]/[id]">) {
  const { kind, id } = await params;
  if (kind !== "players" && kind !== "maps" && kind !== "event-teams") return new Response(null, { status: 404 });

  try {
    const response = await fetch(apiUrl(`/media/${kind}/${encodeURIComponent(id)}`), {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    });
    return new Response(response.body, { status: response.status, headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    } });
  } catch {
    return new Response(null, { status: 502 });
  }
}
