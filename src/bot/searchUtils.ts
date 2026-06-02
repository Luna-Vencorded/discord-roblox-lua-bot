import {
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { fetchScriptDetail, type ScriptResult } from "./scriptblox.js";
import { translateToJapanese } from "./translate.js";

export interface SearchSession {
  allResults: ScriptResult[];
  filtered: ScriptResult[];
  index: number;
  query: string;
  filters: {
    verified: boolean;
    keySystem: boolean;
    universal: boolean;
    hub: boolean;
  };
}

export const searchSessions = new Map<string, SearchSession>();

let _aiChannelId: string | null = null;
export function getAiChannelId(): string | null { return _aiChannelId; }
export function setAiChannelId(id: string | null): void { _aiChannelId = id; }

const translationCache = new Map<string, string>();

export async function enrichScript(s: ScriptResult): Promise<ScriptResult> {
  if (s.creator && s.features) return s;
  const detail = await fetchScriptDetail(s.slug);
  return {
    ...s,
    creator: detail.creator || s.creator || "Anonymous",
    features: detail.features || s.features || "",
    keyLink: detail.keyLink ?? s.keyLink,
    imageUrl: detail.imageUrl !== undefined ? detail.imageUrl : s.imageUrl,
  };
}

export function isValidUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch { return false; }
}

export async function buildScriptEmbed(
  s: ScriptResult,
  index: number,
  total: number,
): Promise<EmbedBuilder> {
  let descJP = translationCache.get(s.slug) ?? "";
  if (!descJP && s.features) {
    const clean = s.features
      .replace(/\n*tags?\s*\(.*?\)[\s\S]*/i, "")
      .replace(/\n*tags?:\s*[\s\S]*/i, "")
      .trim();
    if (clean) {
      descJP = await translateToJapanese(clean);
      translationCache.set(s.slug, descJP);
    }
  }

  const scriptBlock =
    s.script.length <= 1800
      ? "```lua\n" + s.script + "\n```"
      : "```lua\n" + s.script.slice(0, 1800) + "\n…(省略)\n```";

  let descBody = "";
  if (descJP) descBody += descJP + "\n\n";
  descBody += scriptBlock;
  if (s.keySystem && s.keyLink) {
    descBody += `\n\n**Keyシステム:** [Keyを取得する](${s.keyLink})`;
  }

  const badges: string[] = [];
  if (s.isUniversal) badges.push("Universal");
  if (s.isHub) badges.push("Hub");
  if (s.isPatched) badges.push("Patched");

  const embed = new EmbedBuilder()
    .setColor(s.isPatched ? Colors.Red : Colors.Blue)
    .setTitle((badges.length ? `[${badges.join(" | ")}] ` : "") + s.title)
    .setURL(`https://scriptblox.com/script/${s.slug}`)
    .addFields(
      { name: "ゲーム", value: s.game || "Unknown", inline: true },
      { name: "閲覧数", value: s.views.toLocaleString(), inline: true },
      { name: "認証済み", value: s.verified ? "✓ はい" : "✗ いいえ", inline: true },
    )
    .setDescription(descBody.slice(0, 4096))
    .setFooter({ text: `作成者: ${s.creator || "Anonymous"}　|　${s.game}　|　${index + 1} / ${total}` })
    .setTimestamp(s.createdAt ? new Date(s.createdAt) : new Date());

  if (isValidUrl(s.imageUrl)) embed.setThumbnail(s.imageUrl);
  return embed;
}

export function buildNavRow(
  msgId: string,
  index: number,
  total: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sp_${msgId}`)
      .setLabel("◀ PREV")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === 0),
    new ButtonBuilder()
      .setCustomId(`sn_${msgId}`)
      .setLabel("NEXT ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(index >= total - 1),
  );
}

export function buildFilterRow(
  msgId: string,
  filters: SearchSession["filters"],
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sf_v_${msgId}`)
      .setLabel("認証済み")
      .setStyle(filters.verified ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`sf_k_${msgId}`)
      .setLabel("Key System")
      .setStyle(filters.keySystem ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`sf_u_${msgId}`)
      .setLabel("Universal")
      .setStyle(filters.universal ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`sf_h_${msgId}`)
      .setLabel("Hub")
      .setStyle(filters.hub ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`sf_r_${msgId}`)
      .setLabel("リセット")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!filters.verified && !filters.keySystem && !filters.universal && !filters.hub),
  );
}

export function applyFilters(
  results: ScriptResult[],
  filters: SearchSession["filters"],
): ScriptResult[] {
  return results.filter(s => {
    if (filters.verified && !s.verified) return false;
    if (filters.keySystem && !s.keySystem) return false;
    if (filters.universal && !s.isUniversal) return false;
    if (filters.hub && !s.isHub) return false;
    return true;
  });
}
