import fetch from "node-fetch";

const BASE_URL = "https://scriptblox.com/api";
const SITE_URL = "https://scriptblox.com";

export interface ScriptbloxOwner {
  _id: string;
  username: string;
  verified?: boolean;
  profilePicture?: string;
}

export interface ScriptbloxGame {
  _id?: string;
  gameId?: number;
  name?: string;
  imageUrl?: string;
}

export interface ScriptbloxListScript {
  _id: string;
  title: string;
  game: ScriptbloxGame;
  slug: string;
  verified?: boolean;
  key?: boolean;
  views?: number;
  scriptType?: string;
  isUniversal?: boolean;
  isPatched?: boolean;
  image?: string;
  lastBump?: string;
  createdAt: string;
  script: string;
}

export interface ScriptbloxScript extends ScriptbloxListScript {
  owner?: ScriptbloxOwner;
  features?: string;
  tags?: string[];
  keyLink?: string;
  likeCount?: number;
  dislikeCount?: number;
}

export interface ScriptbloxApiResponse {
  result: {
    scripts: ScriptbloxListScript[];
    totalPages: number;
    nextPage: number | null;
    max: number;
  };
}

export function resolveImageUrl(image: string | undefined): string | undefined {
  if (!image) return undefined;
  if (image.startsWith("http")) return image;
  return `${SITE_URL}${image}`;
}

export async function fetchScripts(page: number = 1, max: number = 20): Promise<ScriptbloxApiResponse> {
  const url = `${BASE_URL}/script/fetch?page=${page}&max=${max}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ScriptbloxBot/1.0)",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`scriptblox API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<ScriptbloxApiResponse>;
}

export async function fetchScriptDetail(id: string): Promise<ScriptbloxScript | null> {
  try {
    const url = `${BASE_URL}/script/${id}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ScriptbloxBot/1.0)",
        "Accept": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { script?: ScriptbloxScript } | ScriptbloxScript;
    if ("script" in data && data.script && typeof data.script === "object" && "_id" in data.script) {
      return data.script as ScriptbloxScript;
    }
    return data as ScriptbloxScript;
  } catch {
    return null;
  }
}

export function getScriptPageUrl(slug: string): string {
  return `${SITE_URL}/script/${slug}`;
}

export function getOwnerProfileUrl(username: string): string {
  return `${SITE_URL}/u/${username}`;
}

export function deriveTagNames(script: ScriptbloxScript | ScriptbloxListScript): string[] {
  const tags: string[] = [];
  if (script.isUniversal) {
    tags.push("Universal");
  } else if (script.game?.name) {
    tags.push(script.game.name.slice(0, 20));
  }
  if (script.isPatched) tags.push("Patched");
  if (script.key) tags.push("Key");
  if (script.scriptType === "paid") tags.push("Paid");
  return tags;
}
