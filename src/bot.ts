import {
  Client,
  GatewayIntentBits,
  ForumChannel,
  ThreadAutoArchiveDuration,
  EmbedBuilder,
  bold,
  hyperlink,
  ChannelType,
  type Message,
  type Guild,
  type GuildBasedChannel,
} from "discord.js";
import {
  fetchScripts,
  fetchScriptDetail,
  getScriptPageUrl,
  getOwnerProfileUrl,
  resolveImageUrl,
  deriveTagNames,
  type ScriptbloxScript,
  type ScriptbloxListScript,
} from "./scriptblox.js";
import { translateTitle, translateDescription } from "./translate.js";
import { isPosted, markPosted, getAllPosted, updateViews } from "./store.js";

const GUILD_ID = process.env["GUILD_ID"] ?? "1476104535683371202";
const CHANNEL_ID = process.env["CHANNEL_ID"] ?? "1515622353114107984";
const POST_INTERVAL_MS = Number(process.env["POST_INTERVAL_MS"] ?? "10000");
const VIEW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

let client: Client | null = null;
let isRunning = false;
let stopRequested = false;

function log(msg: string, data?: unknown) {
  console.log(`[${new Date().toISOString()}] ${msg}`, data ?? "");
}

function buildEmbed(script: ScriptbloxScript, translatedTitle: string, translatedDesc: string): EmbedBuilder {
  const scriptUrl = getScriptPageUrl(script.slug);
  const ownerUsername = script.owner?.username ?? "不明";
  const ownerUrl = getOwnerProfileUrl(ownerUsername);

  const embed = new EmbedBuilder()
    .setTitle(translatedTitle.slice(0, 256))
    .setURL(scriptUrl)
    .setColor(0x5865f2)
    .setTimestamp(new Date(script.createdAt));

  const scriptImage = resolveImageUrl(script.image);
  const gameImage = resolveImageUrl(script.game?.imageUrl);
  if (scriptImage) embed.setImage(scriptImage);
  else if (gameImage) embed.setImage(gameImage);

  if (translatedDesc?.trim()) embed.setDescription(translatedDesc.slice(0, 4000));

  const maxLen = 1010;
  const scriptContent = script.script.length <= maxLen ? script.script : script.script.slice(0, maxLen);
  embed.addFields({ name: "スクリプト", value: "```\n" + scriptContent + "\n```" });

  embed.addFields(
    { name: "ゲーム", value: script.game?.name || "Universal", inline: true },
    { name: "閲覧数", value: String(script.views ?? 0), inline: true },
    { name: "作者", value: ownerUsername !== "不明" ? hyperlink(ownerUsername, ownerUrl) : ownerUsername, inline: true },
  );

  embed.setFooter({ text: `ScriptBlox | ${scriptUrl}` });
  return embed;
}

async function getForumChannel(guild: Guild): Promise<ForumChannel> {
  const channel: GuildBasedChannel | null = await guild.channels.fetch(CHANNEL_ID, { force: true });
  if (!channel) throw new Error(`チャンネル ${CHANNEL_ID} が見つかりません。`);
  if (channel.type !== ChannelType.GuildForum) throw new Error(`チャンネル ${CHANNEL_ID} はフォーラムではありません。`);
  return channel as ForumChannel;
}

async function ensureForumTags(forumChannel: ForumChannel, tagNames: string[]): Promise<string[]> {
  const existing = forumChannel.availableTags;
  const tagIds: string[] = [];
  const toCreate: string[] = [];

  for (const name of tagNames) {
    const found = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (found) tagIds.push(found.id);
    else toCreate.push(name);
  }

  if (toCreate.length > 0) {
    const currentTags = existing.map((t) => ({ name: t.name, emoji: t.emoji ?? undefined, moderated: t.moderated }));
    const allTags = [...currentTags, ...toCreate.map((n) => ({ name: n.slice(0, 20) }))].slice(0, 20);
    try {
      const updated = await forumChannel.setAvailableTags(allTags);
      for (const name of toCreate) {
        const found = updated.availableTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (found) tagIds.push(found.id);
      }
    } catch (err) {
      log("Failed to create forum tags", err);
    }
  }

  return tagIds;
}

async function postScript(listScript: ScriptbloxListScript): Promise<void> {
  if (!client) throw new Error("Discord client not ready");

  const script: ScriptbloxScript = (await fetchScriptDetail(listScript._id)) ?? listScript;
  const guild = await client.guilds.fetch(GUILD_ID);
  const forumChannel = await getForumChannel(guild);

  const translatedTitle = await translateTitle(script.title);
  const rawDesc = script.features ?? "";
  const translatedDesc = rawDesc ? await translateDescription(rawDesc) : "";

  const scriptUrl = getScriptPageUrl(script.slug);
  const embed = buildEmbed(script, translatedTitle, translatedDesc);

  const tagNames = deriveTagNames(script);
  const appliedTagIds = await ensureForumTags(forumChannel, tagNames);

  const thread = await forumChannel.threads.create({
    name: translatedTitle.slice(0, 100),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    appliedTags: appliedTagIds.slice(0, 5),
    message: {
      embeds: [embed],
      content: `${bold(translatedTitle)}\n${scriptUrl}`,
    },
  });

  markPosted({
    scriptId: script._id,
    slug: script.slug,
    threadId: thread.id,
    postedAt: new Date().toISOString(),
    views: script.views ?? 0,
    lastViewUpdate: new Date().toISOString(),
  });

  log(`Posted: ${translatedTitle}`, { scriptId: script._id, threadId: thread.id });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runPostLoop(statusMsg: Message): Promise<void> {
  let page = 1;
  let totalPosted = 0;

  await statusMsg.reply("スキャン開始。ページごとに取得して順次投稿します。").catch(() => {});

  while (!stopRequested) {
    try {
      const data = await fetchScripts(page, 20);
      const scripts = data.result.scripts;
      const totalPages = data.result.totalPages;

      log(`Page ${page}/${totalPages}, ${scripts.length} scripts`);

      let postedThisPage = 0;
      for (const script of scripts) {
        if (stopRequested) break;
        if (isPosted(script._id)) continue;

        try {
          await postScript(script);
          totalPosted++;
          postedThisPage++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`Post error: ${script._id}`, msg);
          await statusMsg.reply(`投稿エラー (${script._id}): ${msg}`).catch(() => {});
          if (msg.includes("フォーラムではありません") || msg.includes("見つかりません")) {
            stopRequested = true;
            break;
          }
        }

        await sleep(POST_INTERVAL_MS);
      }

      if (postedThisPage > 0) log(`Page ${page} done, posted ${postedThisPage}`);

      if (page % 10 === 0) {
        await statusMsg.reply(`進捗: ${page}/${totalPages} ページ完了、合計 ${totalPosted} 件投稿`).catch(() => {});
      }

      if (!data.result.nextPage || page >= totalPages) {
        await statusMsg.reply(`全ページスキャン完了（${totalPosted} 件投稿）。5分後に新着確認します。`).catch(() => {});
        await sleep(5 * 60 * 1000);
        page = 1;
        totalPosted = 0;
      } else {
        page++;
        await sleep(2000);
      }
    } catch (err) {
      log("Page fetch error", err);
      await sleep(15_000);
    }
  }

  isRunning = false;
  await statusMsg.reply(`投稿を停止しました（合計 ${totalPosted} 件投稿）。`).catch(() => {});
}

async function runViewUpdateLoop(): Promise<void> {
  while (true) {
    await sleep(VIEW_UPDATE_INTERVAL_MS);

    const posted = getAllPosted();
    log(`View update: ${posted.length} scripts`);

    for (const entry of posted) {
      try {
        const latest = await fetchScriptDetail(entry.scriptId);
        if (latest && client) {
          updateViews(entry.scriptId, latest.views ?? 0);
          const guild = await client.guilds.fetch(GUILD_ID);
          let forumChannel: ForumChannel;
          try { forumChannel = await getForumChannel(guild); } catch { await sleep(3000); continue; }

          try {
            const thread = await forumChannel.threads.fetch(entry.threadId);
            if (thread && !thread.archived) {
              const translatedTitle = await translateTitle(latest.title);
              const rawDesc = latest.features ?? "";
              const translatedDesc = rawDesc ? await translateDescription(rawDesc) : "";
              const embed = buildEmbed(latest, translatedTitle, translatedDesc);
              const messages = await thread.messages.fetch({ limit: 1 });
              const firstMsg = messages.first();
              if (firstMsg && firstMsg.editable) {
                await firstMsg.edit({ embeds: [embed], content: firstMsg.content });
              }
            }
          } catch (err) {
            log(`Thread update error: ${entry.threadId}`, err);
          }
        }
        await sleep(3000);
      } catch (err) {
        log(`View update error: ${entry.scriptId}`, err);
        await sleep(1000);
      }
    }
    log("View update cycle complete");
  }
}

async function handleDebug(message: Message): Promise<void> {
  if (!client) { await message.reply("クライアント未初期化").catch(() => {}); return; }
  const lines: string[] = [];
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    lines.push(`ギルド: **${guild.name}**`);
    const channel = await guild.channels.fetch(CHANNEL_ID, { force: true });
    if (!channel) {
      lines.push(`チャンネル ${CHANNEL_ID} が見つかりません`);
    } else {
      lines.push(`チャンネル: **${channel.name}** (${ChannelType[channel.type]})`);
      const me = guild.members.me;
      if (me) {
        const perms = channel.permissionsFor(me);
        if (perms) {
          lines.push(`ViewChannel: ${perms.has("ViewChannel") ? "OK" : "NG"}`);
          lines.push(`CreatePublicThreads: ${perms.has("CreatePublicThreads") ? "OK" : "NG"}`);
          lines.push(`ManageThreads: ${perms.has("ManageThreads") ? "OK" : "NG"}`);
        }
      }
    }
  } catch (err) {
    lines.push(`エラー: ${err instanceof Error ? err.message : String(err)}`);
  }
  lines.push(`投稿済み: ${getAllPosted().length} 件`);
  lines.push(`投稿中: ${isRunning ? "YES" : "NO"}`);
  await message.reply(lines.join("\n")).catch(() => {});
}

export async function startBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) { console.error("DISCORD_BOT_TOKEN is not set"); process.exit(1); }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("clientReady", () => {
    log(`Bot ready: ${client?.user?.tag}`);
    runViewUpdateLoop().catch((err) => log("View update loop crashed", err));
  });

  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (message.guildId !== GUILD_ID) return;

    const content = message.content.trim();

    if (content === "!go") {
      if (isRunning) { await message.reply("すでに投稿中です。`!stop` で停止できます。").catch(() => {}); return; }
      isRunning = true;
      stopRequested = false;
      await message.reply("scriptblox.com の投稿を開始します。`!stop` で停止できます。").catch(() => {});
      runPostLoop(message).catch((err) => { log("Post loop crashed", err); isRunning = false; });
    }

    if (content === "!stop") {
      if (!isRunning) { await message.reply("投稿は実行されていません。").catch(() => {}); return; }
      stopRequested = true;
      await message.reply("投稿を停止します（現在処理中が終わり次第停止）。").catch(() => {});
    }

    if (content === "!debug") await handleDebug(message);
  });

  client.on("error", (err) => log("Discord client error", err));

  await client.login(token);
}
