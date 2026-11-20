// Localized names follow the Tencent VALORANT game-data catalog.
const agents: Record<string, [slug: string, name: string]> = {
  "0e38b510-41a8-5780-5e8f-568b2a4f2d6c": ["iso", "壹决"],
  "117ed9e3-49f3-6512-3ccf-0cada7e3823b": ["cypher", "零"],
  "1dbf2edd-4729-0984-3115-daa5eed44993": ["clove", "暮蝶"],
  "1e58de9c-4950-5125-93e9-a0aee9f98746": ["killjoy", "奇乐"],
  "22697a3d-45bf-8dd7-4fec-84a9e28c69d7": ["chamber", "尚勃勒"],
  "320b2a48-4d9b-a075-30f1-1f93a9b638fa": ["sova", "猎枭"],
  "41fb69c1-4189-7b37-f117-bcaf1e96f1bf": ["astra", "星礈"],
  "569fdd95-4d10-43ab-ca70-79becc718b46": ["sage", "贤者"],
  "5f8d3a7f-467b-97f3-062c-13acf203c006": ["breach", "铁臂"],
  "601dbbe7-43ce-be57-2a40-4abd24953621": ["kay-o", "K/O"],
  "6f2a04ca-43e0-be17-7f36-b3908627744d": ["skye", "斯凯"],
  "707eab51-4836-f488-046a-cda6bf494859": ["viper", "蝰蛇"],
  "7c8a4701-4de6-9355-b254-e09bc2a34b72": ["miks", "迷核"],
  "7f94d92c-4234-0a36-9646-3a87eb8b5c89": ["yoru", "夜露"],
  "8e253930-4c05-31dd-1b6c-968525494517": ["omen", "幽影"],
  "92eeef5d-43b5-1d4a-8d03-b3927a09034b": ["veto", "禁灭"],
  "95b78ed7-4637-86d9-7e41-71ba8c293152": ["harbor", "海神"],
  "9f0d8ba9-4140-b941-57d3-a7ad57c6b417": ["brimstone", "炼狱"],
  "a3bfb853-43b2-7238-a4f1-ad90e9e46bcc": ["reyna", "芮娜"],
  "add6443a-41bd-e414-f6ad-e58d267f4e95": ["jett", "捷风"],
  "b444168c-4e35-8076-db47-ef9bf368f384": ["tejo", "钛狐"],
  "bb2a4828-46eb-8cd1-e765-15848195d751": ["neon", "霓虹"],
  "cc8b64c8-4b25-4ff9-6e7f-37b4da43d235": ["deadlock", "钢锁"],
  "dade69b4-4f5a-8528-247b-219e5a1facd6": ["fade", "黑梦"],
  "ddd5a15c-4fbe-42fa-3789-11a55ca5ee04": ["hush", "遐思"],
  "df1cb487-4902-002e-5c17-d28e83e78588": ["waylay", "幻棱"],
  "e370fa57-4757-3604-3648-499e1f642d3f": ["gekko", "盖可"],
  "eb93336a-449b-9c1b-0a54-a891f7921d69": ["phoenix", "不死鸟"],
  "efba5359-4016-a1e5-7626-b1ae76895940": ["vyse", "维斯"],
  "f94c3b30-42be-e959-889c-5aa313dba261": ["raze", "雷兹"],
};

export function agent(id: string) {
  const key = id.toLowerCase();
  const entry = Object.hasOwn(agents, key) ? agents[key] : undefined;
  if (!entry) return { name: "未知英雄" };
  const [slug, name] = entry;
  return {
    slug,
    name,
    image: `/agents/${slug}.webp`,
    artwork: `/weekly-agents/${slug}.webp`,
  };
}

export function playerName(player: { agent_id: string; display_name?: string | null }) {
  return player.display_name ?? agent(player.agent_id).name;
}

// Names and bundled covers come from https://val.qq.com/game-data.html?pageType=3.
const maps = {
  Bind: "源工重镇",
  Haven: "隐世修所",
  Split: "霓虹町",
  Ascent: "亚海悬城",
  Icebox: "森寒冬港",
  Breeze: "微风岛屿",
  Fracture: "裂变峡谷",
  Pearl: "深海明珠",
  Lotus: "莲华古城",
  Sunset: "日落之城",
  Abyss: "幽邃地窟",
  Corrode: "盐海矿镇",
  Summit: "天枢云阙",
};

// Older reports can contain the replay's internal map code.
const replayMapCodes: Record<string, keyof typeof maps> = {
  Bonsai: "Split",
  Canyon: "Fracture",
  Duality: "Bind",
  Foxtrot: "Breeze",
  Infinity: "Abyss",
  Jam: "Lotus",
  Juliett: "Sunset",
  Pitt: "Pearl",
  Plummet: "Summit",
  Port: "Icebox",
  Rook: "Corrode",
  Triad: "Haven",
};

export const mapCodes = Object.keys(maps);
export type MapCatalog = Record<string, { display_name: string | null; image_version: string | null }>;
export type ArchiveMap = { code: string; name: string; count: number };

export function catalogImage(tab: "players" | "maps" | "event-teams", id: string, version: string) {
  return `/media/${tab}/${encodeURIComponent(id)}?v=${encodeURIComponent(version)}`;
}

export function mapInfo(id: string, catalog: MapCatalog = {}) {
  const code = Object.hasOwn(replayMapCodes, id) ? replayMapCodes[id] : id;
  const name = Object.hasOwn(maps, code) ? maps[code as keyof typeof maps] : undefined;
  const custom = Object.hasOwn(catalog, code) ? catalog[code] : undefined;
  return {
    name: custom?.display_name ?? name ?? id,
    code,
    image: custom?.image_version ? catalogImage("maps", code, custom.image_version)
      : name ? `/maps/${code.toLowerCase()}.webp` : undefined,
  };
}
