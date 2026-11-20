import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { REPLAY_MAX_BYTES, REPORT_MAX_BYTES } from "@/lib/import-limits";
import { adminRequest, sessionCookie } from "../../session";

export async function POST(request: Request) {
  if (!(await cookies()).has(sessionCookie)) {
    return Response.json({ error: "请重新登录" }, { status: 401 });
  }
  const contentType = request.headers.get("content-type")?.split(";")[0];
  const replay = contentType === "application/octet-stream";
  if (request.headers.get("sec-fetch-site") === "cross-site" ||
      (!replay && contentType !== "application/json")) {
    return Response.json({ error: "请通过本站导入回放或 JSON 报告。" }, { status: 415 });
  }
  const contentLength = request.headers.get("content-length");
  if (Number(contentLength) > (replay ? REPLAY_MAX_BYTES : REPORT_MAX_BYTES)) {
    return Response.json({ error: replay ? "单个回放超过 128 MiB。" : "报告超过 8 MB。" }, { status: 413 });
  }
  try {
    const headers = new Headers({ "Content-Type": replay ? "application/octet-stream" : "application/json" });
    if (contentLength) headers.set("Content-Length", contentLength);
    const response = await adminRequest(replay ? "/imports/replay" : "/imports", {
      method: "POST",
      headers,
      body: request.body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }, replay ? 450_000 : 55_000);
    if (response.ok) revalidatePath("/", "layout");
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "text/plain; charset=utf-8" },
    });
  } catch {
    return Response.json({ error: "未能连接战绩服务，请确认 Axum 已启动。" }, { status: 502 });
  }
}
