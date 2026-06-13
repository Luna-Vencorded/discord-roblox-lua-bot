import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  TextChannel,
  Colors,
  ButtonInteraction,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { fetchScriptDetail, fetchLatestScripts } from "./scriptblox.js";
import { getAIResponse } from "./ai.js";
import { logger } from "../lib/logger.js";
import {
  enrichScript,
  buildScriptEmbed,
  buildNavRow,
  buildFilterRow,
  applyFilters,
  searchSessions,
  getAiChannelId,
  setAiChannelId,
  isValidUrl,
  getNotifyChannelId,
  isNotifyEnabled,
  type SearchSession,
} from "./searchUtils.js";
import { searchScript } from "./scriptblox.js";
import { translateToJapanese } from "./translate.js";
import { registerSlashCommands, handleSlashCommand } from "./slashCommands.js";

const ALLOWED_GUILD = "1490495338296115364";
const ALLOWED_CHANNEL = "1510354846111371377";
const AI_CHANNEL = "1511176152964923493";
const NOTIFY_CHANNEL = "1511170667414818857";

const POLL_INTERVAL_MS = 30 * 1000;
const VIEW_UPDATE_MS   = 5 * 1000;

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const conversationHistory = new Map<string, { role: "user" | "assistant"; content: string }[]>();

// createdAt タイムスタンプで新着を判定（IDではなく日時ベース）
let latestSeenCreatedAt: Date = new Date(0);
let notifyInitialized = false;

// script オブジェクトは不要 — slug だけあれば閲覧数をAPIから取得できる
type ViewTracker =
  | { type: "search"; slug: string; channelId: string }
  | { type: "notify"; slug: string; channelId: string };

const viewTrackers = new Map<string, ViewTracker>();

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  while (text.length > maxLen) {
    let idx = text.lastIndexOf("\n", maxLen);
    if (idx < 0) idx = maxLen;
    chunks.push(text.slice(0, idx));
    text = text.slice(idx).trimStart();
  }
  if (text) chunks.push(text);
  return chunks;
}

// ─────────────────────────────────────────────────
// 閲覧数リアルタイム更新（5秒ごと）
// ─────────────────────────────────────────────────

async function refreshViewCounts(): Promise<void> {
  for (const [msgId, tracker] of viewTrackers) {
    try {
      const guild = client.guilds.cache.get(ALLOWED_GUILD);
      const ch = guild?.channels.cache.get(tracker.channelId) as TextChannel | undefined;
      if (!ch) continue;

      const detail = await fetchScriptDetail(tracker.slug);
      const freshViews = typeof detail.views === "number" ? detail.views : null;
      if (freshViews === null) continue;

      if (tracker.type === "search") {
        const session = searchSessions.get(msgId);
        if (!session) { viewTrackers.delete(msgId); continue; }

        const s = session.filtered[session.index];
        if (!s || s.slug !== tracker.slug) continue;
        s.views = freshViews;

        const msg = await ch.messages.fetch(msgId).catch(() => null);
        if (!msg) { viewTrackers.delete(msgId); continue; }

        const embed = await buildScriptEmbed(s, session.index, session.filtered.length);
        await msg.edit({ embeds: [embed], components: msg.components });

      } else {
        // notify — embedの「閲覧数」フィールドだけ書き換えて再送
        const msg = await ch.messages.fetch(msgId).catch(() => null);
        if (!msg) {
          viewTrackers.delete(msgId);
          continue;
        }

        const existing = msg.embeds[0];
        if (!existing) continue;

        const updatedFields = existing.fields.map(f =>
          f.name === "閲覧数"
            ? { name: f.name, value: freshViews.toLocaleString(), inline: f.inline ?? true }
            : { name: f.name, value: f.value, inline: f.inline ?? true },
        );

        const updated = EmbedBuilder.from(existing).setFields(updatedFields);
        await msg.edit({ embeds: [updated] });
      }
    } catch {
      // サイレントに無視
    }
  }
}

// ─────────────────────────────────────────────────
// Bot起動時：過去の通知メッセージを全スキャンして登録
// ─────────────────────────────────────────────────

async function loadHistoricalNotifications(): Promise<void> {
  const guild = client.guilds.cache.get(ALLOWED_GUILD);
  const ch = guild?.channels.cache.get(NOTIFY_CHANNEL) as TextChannel | undefined;
  if (!ch) return;

  let before: string | undefined;
  let loaded = 0;

  // Discord APIは1回100件まで — 最大5回 = 500件スキャン
  for (let page = 0; page < 5; page++) {
    const messages = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (messages.size === 0) break;

    for (const [msgId, msg] of messages) {
      if (msg.author.id !== client.user!.id) continue;
      const embed = msg.embeds[0];
      if (!embed?.url) continue;

      const match = embed.url.match(/scriptblox\.com\/script\/([^/?#]+)/);
      if (!match) continue;

      const slug = match[1];

      if (!viewTrackers.has(msgId)) {
        viewTrackers.set(msgId, { type: "notify", slug, channelId: NOTIFY_CHANNEL });
        loaded++;
      }
    }

    before = messages.last()?.id;
    if (messages.size < 100) break;
  }

  logger.info({ loaded }, "Historical notifications loaded for view tracking");
}

// ─────────────────────────────────────────────────
// 新着スクリプト通知 embed 生成
// ─────────────────────────────────────────────────

async function buildNotifyEmbed(s: import("./scriptblox.js").ScriptResult): Promise<EmbedBuilder> {
  const descRaw = s.features || "";
  const descClean = descRaw
    .replace(/\n*tags?\s*\(.*?\)[\s\S]*/i, "")
    .replace(/\n*tags?:\s*[\s\S]*/i, "")
    .trim();
  const descJP = descClean ? await translateToJapanese(descClean) : "";

  let descBody = descJP ? descJP + "\n\n" : "";
  descBody += s.script.length <= 1800
    ? "```lua\n" + s.script + "\n```"
    : "```lua\n" + s.script.slice(0, 1800) + "\n…(省略)\n```";
  if (s.keySystem && s.keyLink) {
    descBody += `\n\n**Keyシステム:** [Keyを取得する](${s.keyLink})`;
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Gold)
    .setTitle(s.title)
    .setURL(`https://scriptblox.com/script/${s.slug}`)
    .addFields(
      { name: "ゲーム", value: s.game || "Unknown", inline: true },
      { name: "閲覧数", value: s.views.toLocaleString(), inline: true },
      { name: "認証済み", value: s.verified ? "✓ はい" : "✗ いいえ", inline: true },
    )
    .setDescription(descBody.slice(0, 4096))
    .setFooter({ text: `作成者: ${s.creator || "Anonymous"}　|　${s.game}` })
    .setTimestamp(s.createdAt ? new Date(s.createdAt) : new Date());
  if (isValidUrl(s.imageUrl)) embed.setThumbnail(s.imageUrl);
  return embed;
}

// ─────────────────────────────────────────────────
// 新着スクリプトポーリング（30秒おき — リアルタイム）
// createdAt タイムスタンプ基準で判定（lastBump でソートされるAPIに対応）
// ─────────────────────────────────────────────────

async function pollNewScripts(): Promise<void> {
  if (!isNotifyEnabled()) return;
  try {
    // max=50 で取得。APIは lastBump でソートされるため、新着が上位に来ない場合も多い
    const scripts = await fetchLatestScripts(1, 50);
    if (scripts.length === 0) return;

    if (!notifyInitialized) {
      // 初回: 現在の最新 createdAt をベースラインとして記録
      const times = scripts
        .map(s => new Date(s.createdAt || 0).getTime())
        .filter(t => !isNaN(t) && t > 0);
      if (times.length > 0) {
        latestSeenCreatedAt = new Date(Math.max(...times));
      }
      notifyInitialized = true;
      logger.info(
        { baseline: latestSeenCreatedAt.toISOString(), total: scripts.length },
        "New script watcher initialized (createdAt-based)",
      );
      return;
    }

    // createdAt がベースラインより新しいスクリプトのみ通知対象
    const newScripts = scripts.filter(s => {
      const t = new Date(s.createdAt || 0).getTime();
      return !isNaN(t) && t > latestSeenCreatedAt.getTime();
    });

    if (newScripts.length === 0) return;

    // ベースラインを更新（最も新しい createdAt）
    const maxTime = Math.max(...newScripts.map(s => new Date(s.createdAt || 0).getTime()));
    latestSeenCreatedAt = new Date(maxTime);

    // 古い順に並べて通知（投稿順に流す）
    newScripts.sort(
      (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
    );

    const notifyChannelId = getNotifyChannelId() ?? NOTIFY_CHANNEL;
    const guild = client.guilds.cache.get(ALLOWED_GUILD);
    const ch = guild?.channels.cache.get(notifyChannelId) as TextChannel | undefined;
    if (!ch) {
      logger.warn({ notifyChannelId }, "Notify channel not found in guild cache");
      return;
    }

    for (const raw of newScripts) {
      const s = await enrichScript(raw);
      const embed = await buildNotifyEmbed(s);
      const sent = await ch.send({
        content: "<@1515392644417585233> 新しいスクリプトが投稿されました！",
        embeds: [embed],
      });
      logger.info({ title: s.title, createdAt: s.createdAt }, "New script notified");
      viewTrackers.set(sent.id, { type: "notify", slug: s.slug, channelId: notifyChannelId });
    }
  } catch (err) {
    logger.error({ err }, "Poll new scripts error");
  }
}

// ─────────────────────────────────────────────────
// Search embed sender
// ─────────────────────────────────────────────────

async function sendSearchResults(
  channel: TextChannel,
  results: import("./scriptblox.js").ScriptResult[],
  query: string,
  filters: SearchSession["filters"],
): Promise<void> {
  const noFilter = !Object.values(filters).some(Boolean);
  const filtered = noFilter ? results : applyFilters(results, filters);
  if (filtered.length === 0) {
    await channel.send("フィルター条件に一致するスクリプトが見つかりませんでした。");
    return;
  }

  filtered[0] = await enrichScript(filtered[0]);
  const embed = await buildScriptEmbed(filtered[0], 0, filtered.length);
  const sent = await channel.send({ embeds: [embed] });

  const session: SearchSession = { allResults: results, filtered, index: 0, query, filters };
  searchSessions.set(sent.id, session);

  const components = filtered.length > 1
    ? [buildNavRow(sent.id, 0, filtered.length), buildFilterRow(sent.id, filters)]
    : [buildFilterRow(sent.id, filters)];
  await sent.edit({ components });

  viewTrackers.set(sent.id, { type: "search", slug: filtered[0].slug, channelId: channel.id });

  setTimeout(() => {
    searchSessions.delete(sent.id);
    viewTrackers.delete(sent.id);
    sent.edit({ components: [] }).catch(() => {});
  }, 10 * 60 * 1000);

  if (filtered[0].script.length > 1800) {
    await channel.send({
      content: "`script.lua` 全文",
      files: [{ name: "script.lua", attachment: Buffer.from(filtered[0].script, "utf-8") }],
    });
  }
}

// ─────────────────────────────────────────────────
// Button handler
// ─────────────────────────────────────────────────

async function handleButton(btn: ButtonInteraction): Promise<void> {
  const id = btn.customId;
  const isNav = id.startsWith("sp_") || id.startsWith("sn_");
  const isFilter = id.startsWith("sf_");
  if (!isNav && !isFilter) return;

  const isPrev = id.startsWith("sp_");
  const filterKey = isFilter ? id.slice(3, 5) : "";
  const msgId = isNav ? id.slice(3) : id.slice(5);

  const session = searchSessions.get(msgId);
  if (!session) {
    await btn.reply({ content: "セッションが期限切れです。再度検索してください。", flags: MessageFlags.Ephemeral });
    return;
  }

  await btn.deferUpdate();

  if (isNav) {
    session.index = isPrev
      ? Math.max(0, session.index - 1)
      : Math.min(session.filtered.length - 1, session.index + 1);
    session.filtered[session.index] = await enrichScript(session.filtered[session.index]);
    viewTrackers.set(msgId, { type: "search", slug: session.filtered[session.index].slug, channelId: btn.channelId });
  }

  if (isFilter) {
    if (filterKey === "r_") {
      session.filters = { verified: false, keySystem: false, universal: false, hub: false };
    } else if (filterKey === "v_") {
      session.filters.verified = !session.filters.verified;
    } else if (filterKey === "k_") {
      session.filters.keySystem = !session.filters.keySystem;
    } else if (filterKey === "u_") {
      session.filters.universal = !session.filters.universal;
    } else if (filterKey === "h_") {
      session.filters.hub = !session.filters.hub;
    }
    session.filtered = applyFilters(session.allResults, session.filters);
    session.index = 0;
    if (session.filtered.length === 0) {
      await btn.editReply({ content: "フィルター条件に一致するスクリプトが見つかりませんでした。", embeds: [], components: [] });
      return;
    }
    session.filtered[0] = await enrichScript(session.filtered[0]);
    viewTrackers.set(msgId, { type: "search", slug: session.filtered[0].slug, channelId: btn.channelId });
  }

  const s = session.filtered[session.index];
  const embed = await buildScriptEmbed(s, session.index, session.filtered.length);
  const components = session.filtered.length > 1
    ? [buildNavRow(msgId, session.index, session.filtered.length), buildFilterRow(msgId, session.filters)]
    : [buildFilterRow(msgId, session.filters)];
  await btn.editReply({ embeds: [embed], components });
}

// ─────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  logger.info({ tag: c.user.tag }, "Discord bot ready");
  await registerSlashCommands(c.user.id);

  // 過去の通知メッセージをトラッキング登録（起動時1回）
  await loadHistoricalNotifications();

  // 新着チェック開始（30秒おき — リアルタイム）
  pollNewScripts();
  setInterval(pollNewScripts, POLL_INTERVAL_MS);

  // 閲覧数リアルタイム更新（5秒ごと）
  setInterval(refreshViewCounts, VIEW_UPDATE_MS);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction as ChatInputCommandInteraction).catch((err) => {
      logger.error({ err }, "Slash command error");
    });
    return;
  }
  if (interaction.isButton()) {
    await handleButton(interaction as ButtonInteraction).catch((err) => {
      logger.error({ err }, "Button interaction error");
    });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.guildId !== ALLOWED_GUILD) return;
  // すべての操作は /コマンドで行ってください
});

// ─────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────

export function startBot(): void {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.error("DISCORD_BOT_TOKEN is not set");
    return;
  }
  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });
}
