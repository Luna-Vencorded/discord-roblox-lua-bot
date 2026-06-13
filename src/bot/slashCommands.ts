import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  Colors,
  MessageFlags,
} from "discord.js";
import { searchScript, fetchLatestScripts, fetchScriptDetail } from "./scriptblox.js";
import { getAIResponse, obfuscateLua, deobfuscateLua, explainLua, fixLua } from "./ai.js";
import { logger } from "../lib/logger.js";
import {
  enrichScript,
  buildScriptEmbed,
  buildNavRow,
  buildFilterRow,
  applyFilters,
  searchSessions,
  setAiChannelId,
  type SearchSession,
} from "./searchUtils.js";

const ALLOWED_GUILDS = [
  "1490495338296115364",
  "1476104535683371202"
];
const ALLOWED_CHANNELS = [
  "1510354846111371377",
  "1515385929584480316"
];
const AI_CHANNELS = [
  "1511176152964923493",
  "1515385854686789682"                 
];

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Roblox Luauスクリプトを検索します")
    .addStringOption(o => o.setName("query").setDescription("スクリプト名").setRequired(true))
    .addBooleanOption(o => o.setName("verified").setDescription("認証済みのみ"))
    .addBooleanOption(o => o.setName("key").setDescription("Keyシステムのみ"))
    .addBooleanOption(o => o.setName("universal").setDescription("Universalのみ"))
    .addBooleanOption(o => o.setName("hub").setDescription("Hubのみ")),

  new SlashCommandBuilder()
    .setName("latest")
    .setDescription("ScriptBloxの最新スクリプト一覧を表示します"),

  new SlashCommandBuilder()
    .setName("hub")
    .setDescription("Script Hubを専用検索します")
    .addStringOption(o => o.setName("query").setDescription("キーワード（省略可）")),

  new SlashCommandBuilder()
    .setName("aichat")
    .setDescription(`AIにRoblox Luauの質問をします (AIチャンネルのみ)`)
    .addStringOption(o => o.setName("question").setDescription("質問内容").setRequired(true)),

  new SlashCommandBuilder()
    .setName("obfuscate")
    .setDescription("Luauコードを難読化します（ファイル or テキスト）")
    .addAttachmentOption(o => o.setName("file").setDescription(".lua / .txt ファイル"))
    .addStringOption(o => o.setName("code").setDescription("直接貼り付けるLuauコード")),

  new SlashCommandBuilder()
    .setName("deobfuscate")
    .setDescription("難読化されたLuauコードを解読します（ファイル or テキスト）")
    .addAttachmentOption(o => o.setName("file").setDescription(".lua / .txt ファイル"))
    .addStringOption(o => o.setName("code").setDescription("直接貼り付けるLuauコード")),

  new SlashCommandBuilder()
    .setName("explain")
    .setDescription("Luauスクリプトの機能を日本語で解説します（ファイル or テキスト）")
    .addAttachmentOption(o => o.setName("file").setDescription(".lua / .txt ファイル"))
    .addStringOption(o => o.setName("code").setDescription("直接貼り付けるLuauコード")),

  new SlashCommandBuilder()
    .setName("fix")
    .setDescription("Luauスクリプトのバグを修正します（ファイル or テキスト）")
    .addAttachmentOption(o => o.setName("file").setDescription(".lua / .txt ファイル"))
    .addStringOption(o => o.setName("code").setDescription("直接貼り付けるLuauコード")),

  new SlashCommandBuilder()
    .setName("aiset")
    .setDescription("このチャンネルでAI自動応答を開始します"),

  new SlashCommandBuilder()
    .setName("aioff")
    .setDescription("AI自動応答を停止します"),

  new SlashCommandBuilder()
    .setName("keyinfo")
    .setDescription("スクリプトのKeyシステム情報を確認します")
    .addStringOption(o => o.setName("slug").setDescription("スクリプトのslug（URLの末尾部分）").setRequired(true)),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Botの動作状態を表示します"),
].map(c => c.toJSON());

export async function registerSlashCommands(clientId: string): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) return;

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    for (const guild of ALLOWED_GUILDS) {
      await rest.put(Routes.applicationGuildCommands(clientId, guild), {
        body: commandDefinitions,
      });
    }
    logger.info("Slash commands registered (guild)");
    return;
  } catch (err) {
    logger.warn({ err }, "Guild slash commands failed, trying global...");
  }

  try {
    await rest.put(Routes.applicationCommands(clientId), { body: commandDefinitions });
    logger.info("Slash commands registered (global — may take up to 1 hour)");
  } catch (err) {
    logger.error({ err }, "Slash command registration failed entirely");
    logger.info(
      `Re-invite URL with correct scope: https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`,
    );
  }
}

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

async function sendLongReply(
  interaction: ChatInputCommandInteraction,
  title: string,
  content: string,
  color: number,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(content.slice(0, 4096))
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

function makeSession(
  all: import("./scriptblox.js").ScriptResult[],
  filtered: import("./scriptblox.js").ScriptResult[],
  query: string,
  filters: SearchSession["filters"],
): SearchSession {
  return { allResults: all, filtered, index: 0, query, filters };
}

// ファイル添付またはテキストからコードを取得する
async function resolveCode(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const attachment = interaction.options.getAttachment("file");
  if (attachment) {
    // MIMEタイプまたは拡張子チェック
    const name = attachment.name?.toLowerCase() ?? "";
    if (!name.endsWith(".lua") && !name.endsWith(".txt") && !attachment.contentType?.startsWith("text/")) {
      await interaction.editReply({ content: "`.lua` または `.txt` ファイルを添付してください。" });
      return null;
    }
    if (attachment.size > 200_000) {
      await interaction.editReply({ content: "ファイルサイズが大きすぎます（上限200KB）。" });
      return null;
    }
    const res = await fetch(attachment.url);
    return await res.text();
  }

  const code = interaction.options.getString("code");
  if (!code) {
    await interaction.editReply({ content: "ファイルを添付するか、`code` にコードを入力してください。" });
    return null;
  }
  return code;
}

export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const { commandName, guildId, channelId } = interaction;
  const inGuild = guildId ? ALLOWED_GUILDS.includes(guildId) : false;
  const inAllowed =
    inGuild &&
    ALLOWED_CHANNELS.includes(channelId);
  const inAI =
    inGuild &&
    AI_CHANNELS.includes(channelId);

  if (commandName === "status") {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle("Bot ステータス")
          .addFields(
            { name: "検索チャンネル", value: ALLOWED_CHANNELS.map(id => `<#${id}>`).join(", "), inline: true },
            { name: "AIチャンネル", value: AI_CHANNELS.map(id => `<#${id}>`).join(", "), inline: true },
            { name: "通知チャンネル", value: "<#1511170667414818857>", inline: true },
          )
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!inGuild) {
    await interaction.reply({ content: "このサーバーでは使用できません。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (commandName === "aiset") {
    setAiChannelId(channelId);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle("AI自動応答 有効")
          .setDescription(`<#${channelId}> でAI自動応答を開始しました。`)
          .setTimestamp(),
      ],
    });
    return;
  }
  if (commandName === "aioff") {
    setAiChannelId(null);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Red)
          .setTitle("AI自動応答 無効")
          .setDescription("AI自動応答を停止しました。")
          .setTimestamp(),
      ],
    });
    return;
  }

  if (commandName === "aichat") {
    if (!inAI) {
      await interaction.reply({ content: `AIコマンドは ${AI_CHANNELS.map(id => `<#${id}>`).join(", ")} でのみ使用できます。`, flags: MessageFlags.Ephemeral });
      return;
    }
    const question = interaction.options.getString("question", true);
    await interaction.deferReply();
    const answer = await getAIResponse(question, []);
    const chunks = splitMessage(answer, 1990);
    await interaction.editReply(chunks[0] ?? "...");
    for (const c of chunks.slice(1)) await interaction.followUp(c);
    return;
  }

  if (["obfuscate", "deobfuscate", "explain", "fix"].includes(commandName)) {
    await interaction.deferReply();

    const code = await resolveCode(interaction);
    if (code === null) return;

    let result: string;
    let title: string;
    let color: number;
    switch (commandName) {
      case "obfuscate":   result = await obfuscateLua(code);   title = "難読化結果（Luau）";   color = Colors.Orange;  break;
      case "deobfuscate": result = await deobfuscateLua(code); title = "解読結果（Luau）";     color = Colors.Purple;  break;
      case "explain":     result = await explainLua(code);     title = "スクリプト解説（Luau）"; color = Colors.Blurple; break;
      default:            result = await fixLua(code);         title = "バグ修正結果（Luau）"; color = Colors.Green;   break;
    }
    await sendLongReply(interaction, title, result, color);
    return;
  }

  if (!inAllowed) {
    await interaction.reply({
      content: `検索コマンドは ${ALLOWED_CHANNELS.map(id => `<#${id}>`).join(", ")} でのみ使用できます。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (commandName === "search") {
    const query = interaction.options.getString("query", true);
    const filters: SearchSession["filters"] = {
      verified:  interaction.options.getBoolean("verified") ?? false,
      keySystem: interaction.options.getBoolean("key")      ?? false,
      universal: interaction.options.getBoolean("universal") ?? false,
      hub:       interaction.options.getBoolean("hub")      ?? false,
    };
    await interaction.deferReply();

    const all = await searchScript(query, 20);
    if (all.length === 0) { await interaction.editReply(`"${query}" に関するスクリプトが見つかりませんでした。`); return; }

    const filtered = applyFilters(all, filters);
    if (filtered.length === 0) { await interaction.editReply("フィルター条件に一致するスクリプトが見つかりませんでした。"); return; }

    filtered[0] = await enrichScript(filtered[0]);
    const embed = await buildScriptEmbed(filtered[0], 0, filtered.length);
    const reply = await interaction.editReply({ embeds: [embed] });

    if (filtered.length > 1 || Object.values(filters).some(Boolean)) {
      const session = makeSession(all, filtered, query, filters);
      searchSessions.set(reply.id, session);
      await interaction.editReply({
        embeds: [embed],
        components: [buildNavRow(reply.id, 0, filtered.length), buildFilterRow(reply.id, filters)],
      });
      setTimeout(() => searchSessions.delete(reply.id), 10 * 60 * 1000);
    }
    return;
  }

  if (commandName === "latest") {
    await interaction.deferReply();
    const scripts = await fetchLatestScripts(1);
    if (scripts.length === 0) { await interaction.editReply("最新スクリプトの取得に失敗しました。"); return; }
    scripts[0] = await enrichScript(scripts[0]);
    const embed = await buildScriptEmbed(scripts[0], 0, scripts.length);
    const reply = await interaction.editReply({ embeds: [embed] });
    if (scripts.length > 1) {
      const noFilter = { verified: false, keySystem: false, universal: false, hub: false };
      const session = makeSession(scripts, scripts, "latest", noFilter);
      searchSessions.set(reply.id, session);
      await interaction.editReply({ embeds: [embed], components: [buildNavRow(reply.id, 0, scripts.length)] });
      setTimeout(() => searchSessions.delete(reply.id), 10 * 60 * 1000);
    }
    return;
  }

  if (commandName === "hub") {
    const query = interaction.options.getString("query") ?? "script hub";
    await interaction.deferReply();
    const all = await searchScript(query, 20);
    const filtered = all.filter(s => s.isHub);
    if (filtered.length === 0) { await interaction.editReply("Script Hubが見つかりませんでした。"); return; }
    filtered[0] = await enrichScript(filtered[0]);
    const embed = await buildScriptEmbed(filtered[0], 0, filtered.length);
    const reply = await interaction.editReply({ embeds: [embed] });
    if (filtered.length > 1) {
      const hubFilter = { verified: false, keySystem: false, universal: false, hub: true };
      const session = makeSession(all, filtered, query, hubFilter);
      searchSessions.set(reply.id, session);
      await interaction.editReply({ embeds: [embed], components: [buildNavRow(reply.id, 0, filtered.length)] });
      setTimeout(() => searchSessions.delete(reply.id), 10 * 60 * 1000);
    }
    return;
  }

  if (commandName === "keyinfo") {
    const slug = interaction.options.getString("slug", true);
    await interaction.deferReply();
    const detail = await fetchScriptDetail(slug);
    const embed = new EmbedBuilder()
      .setColor(detail.keyLink ? Colors.Yellow : Colors.Green)
      .setTitle(detail.keyLink ? "Keyシステム あり" : "Keyシステム なし")
      .addFields(
        { name: "作者", value: detail.creator || "不明", inline: true },
        { name: "Keyシステム", value: detail.keyLink ? "あり" : "なし", inline: true },
      )
      .setTimestamp();
    if (detail.keyLink) embed.addFields({ name: "Key取得リンク", value: detail.keyLink });
    await interaction.editReply({ embeds: [embed] });
    return;
  }
}
