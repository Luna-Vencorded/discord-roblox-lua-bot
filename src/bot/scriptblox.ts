import axios from "axios";

const BASE = "https://scriptblox.com";

export interface ScriptResult {
  scriptId: string;
  title: string;
  game: string;
  features: string;
  script: string;
  keySystem: boolean;
  keyLink: string | null;
  views: number;
  verified: boolean;
  isUniversal: boolean;
  isHub: boolean;
  isPatched: boolean;
  likeCount: number;
  dislikeCount: number;
  createdAt: string;
  slug: string;
  imageUrl: string | null;
  creator: string;
}

function resolveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${BASE}${url}`;
  return null;
}

function parseListScript(s: Record<string, unknown>): ScriptResult {
  const game = s.game as Record<string, unknown> | null;

  const rawImage = (s.image as string) || (game?.imageUrl as string) || null;
  const imageUrl = resolveUrl(rawImage);

  return {
    scriptId: (s._id as string) ?? "",
    title: (s.title as string) || "No title",
    game: (game?.name as string) || "Unknown",
    features: "",
    script: (s.script as string) ?? "",
    keySystem: !!(s.key),
    keyLink: null,
    views: (s.views as number) ?? 0,
    verified: !!(s.verified),
    isUniversal: !!(s.isUniversal),
    isHub: !!(s.isHub),
    isPatched: !!(s.isPatched),
    likeCount: (s.likeCount as number) ?? 0,
    dislikeCount: (s.dislikeCount as number) ?? 0,
    createdAt: (s.createdAt as string) ?? "",
    slug: (s.slug as string) ?? "",
    imageUrl,
    creator: "",
  };
}

export async function fetchScriptDetail(slug: string): Promise<Partial<ScriptResult>> {
  try {
    const res = await axios.get(`${BASE}/api/script/${slug}`, { timeout: 8000 });
    const s = res.data?.script as Record<string, unknown> | undefined;
    if (!s) return {};

    const owner = s.owner as Record<string, unknown> | null;
    const game = s.game as Record<string, unknown> | null;
    const rawImage = (s.image as string) || (game?.imageUrl as string) || null;
    const imageUrl = resolveUrl(rawImage);

    return {
      creator: (owner?.username as string) || "Anonymous",
      features: (s.features as string) || "",
      keyLink: (s.keyLink as string) || null,
      imageUrl,
      views: typeof s.views === "number" ? s.views : undefined,
    };
  } catch {
    return {};
  }
}

export async function searchScript(query: string, max = 20): Promise<ScriptResult[]> {
  const url = `${BASE}/api/script/search?q=${encodeURIComponent(query)}&max=${max}&mode=free`;
  const res = await axios.get(url, { timeout: 10000 });
  const scripts: Record<string, unknown>[] = res.data?.result?.scripts ?? [];
  return scripts.map(parseListScript);
}

export async function fetchLatestScripts(page = 1): Promise<ScriptResult[]> {
  const url = `${BASE}/api/script/fetch?page=${page}&max=10`;
  const res = await axios.get(url, { timeout: 10000 });
  const scripts: Record<string, unknown>[] = res.data?.result?.scripts ?? [];
  return scripts.map(parseListScript);
}
