import { notFound } from "next/navigation";
import type { MapCatalog } from "./catalog";

const apiOrigin = () => process.env.VLTV_API_URL ?? "http://127.0.0.1:3101";
export const apiUrl = (path: string) => new URL(path, apiOrigin());

const archiveResponse = (path: string) =>
  fetch(apiUrl(path), { cache: "no-store", signal: AbortSignal.timeout(8000) });

export async function readArchive<T>(path: string): Promise<T> {
  const response = await archiveResponse(path);
  if (response.status === 404 || response.status === 400) notFound();
  if (!response.ok) throw new Error("Archive API request failed");
  return response.json() as Promise<T>;
}

export async function readMapCatalog(): Promise<MapCatalog> {
  const response = await archiveResponse("/maps");
  if (response.status === 404) return {};
  if (!response.ok) throw new Error("Map API request failed");
  const maps: ({ map_id: string } & MapCatalog[string])[] = await response.json();
  return Object.fromEntries(maps.map(({ map_id, ...entry }) => [map_id, entry]));
}
