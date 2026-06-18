import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
} from "discord.js";

const GUILD_ID = process.env["GUILD_ID"] ?? "1476104535683371202";
const VERIFY_CHANNEL_ID = "1515354201419546694";
const VERIFY_ROLE_ID = "1488884755817566349";

let client: Client | null = null;

function log(msg: string, data?: unknown) {
  console.log(`[${new Date().toISOString()}] ${msg}`, data ?? "");
}

const commands = [
  new SlashCommandBuilder()
    .setName("tag")
    .setDescription("タグコマンド")
    .addSubcommand((sub) =>
      sub
        .setName("verify")
        .setDescription("認証してロールを取得します")
    ),
].map((cmd) => cmd.toJSON());

async function registerCommands(clientId: string, token: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    log("スラッシュコマンドを登録中...");
    await rest.put(Routes.applicationGuildCommands(clientId, GUILD_ID), { body: commands });
    log("スラッシュコマンドの登録が完了しました");
  } catch (err) {
    log("スラッシュコマンドの登録に失敗しました", err);
  }
}

async function handleVerify(interaction: ChatInputCommandInteraction): Promise<void> {
  // 指定チャンネル以外では使用不可
  if (interaction.channelId !== VERIFY_CHANNEL_ID) {
    await interaction.reply({
      content: "このコマンドは <#" + VERIFY_CHANNEL_ID + "> でのみ使用できます。",
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember | null;
  if (!member) {
    await interaction.reply({ content: "サーバー内で実行してください。", ephemeral: true });
    return;
  }

  // 既にロールを持っている場合
  if (member.roles.cache.has(VERIFY_ROLE_ID)) {
    await interaction.reply({ content: "すでに認証済みです。", ephemeral: true });
    return;
  }

  try {
    await member.roles.add(VERIFY_ROLE_ID);
    await interaction.reply({
      content: "✅ 認証完了！ロールが付与されました。",
      ephemeral: true,
    });
    log(`Verified: ${member.user.tag} (${member.user.id})`);
  } catch (err) {
    log("ロール付与に失敗しました", err);
    await interaction.reply({
      content: "ロールの付与に失敗しました。ボットに「ロールの管理」権限があるか確認してください。",
      ephemeral: true,
    });
  }
}

export async function startBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    console.error("DISCORD_BOT_TOKEN is not set");
    process.exit(1);
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });

  client.once("clientReady", async (c) => {
    log(`Bot ready: ${c.user.tag}`);
    await registerCommands(c.user.id, token);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (
      interaction.commandName === "tag" &&
      interaction.options.getSubcommand() === "verify"
    ) {
      await handleVerify(interaction).catch((err) =>
        log("handleVerify error", err)
      );
    }
  });

  client.on("error", (err) => log("Discord client error", err));

  await client.login(token);
}
