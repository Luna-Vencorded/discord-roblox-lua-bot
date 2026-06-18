import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  type Message,
} from "discord.js";

const GUILD_ID = process.env["GUILD_ID"] ?? "1476104535683371202";
const VERIFY_CHANNEL_ID = "1515354201419546694";
const VERIFY_ROLE_ID = "1488884755817566349";
const VERIFY_EMOJI_ID = "1438065148614017119";

let client: Client | null = null;
// 起動時にDiscord APIからemoji名を取得して置き換える（取得失敗時は✅にフォールバック）
let verifyEmoji = "✅";

function log(msg: string, data?: unknown) {
  console.log(`[${new Date().toISOString()}] ${msg}`, data ?? "");
}

/**
 * Discord Developer Portal で作成したアプリケーション絵文字を取得する。
 * 取得できれば <:name:id> 形式の文字列を返す。
 */
async function loadVerifyEmoji(clientId: string, token: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    // アプリケーション絵文字として取得を試みる
    const emoji = await rest.get(
      `/applications/${clientId}/emojis/${VERIFY_EMOJI_ID}`
    ) as { name: string; id: string; animated?: boolean };
    const prefix = emoji.animated ? "a" : "";
    verifyEmoji = `<${prefix}:${emoji.name}:${emoji.id}>`;
    log(`絵文字を読み込みました: ${verifyEmoji}`);
  } catch {
    // アプリケーション絵文字で取得できなければギルド絵文字を試みる
    try {
      const emoji = await rest.get(
        `/guilds/${GUILD_ID}/emojis/${VERIFY_EMOJI_ID}`
      ) as { name: string; id: string; animated?: boolean };
      const prefix = emoji.animated ? "a" : "";
      verifyEmoji = `<${prefix}:${emoji.name}:${emoji.id}>`;
      log(`ギルド絵文字を読み込みました: ${verifyEmoji}`);
    } catch (err) {
      log("絵文字の取得に失敗しました。✅ にフォールバックします。", err);
    }
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("tag")
    .setDescription("タグコマンド")
    .addSubcommand((sub) =>
      sub.setName("verify").setDescription("認証してロールを取得します")
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

async function grantVerifyRole(member: GuildMember, reply: (msg: string) => Promise<unknown>): Promise<void> {
  if (member.roles.cache.has(VERIFY_ROLE_ID)) {
    await reply("すでに認証済みです。");
    return;
  }
  try {
    await member.roles.add(VERIFY_ROLE_ID);
    await reply(`${verifyEmoji} 認証完了！ロールが付与されました。`);
    log(`Verified: ${member.user.tag} (${member.user.id})`);
  } catch (err) {
    log("ロール付与に失敗しました", err);
    await reply("ロールの付与に失敗しました。ボットに「ロールの管理」権限があるか確認してください。");
  }
}

// スラッシュコマンド /tag verify
async function handleSlashVerify(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.channelId !== VERIFY_CHANNEL_ID) {
    await interaction.reply({
      content: `このコマンドは <#${VERIFY_CHANNEL_ID}> でのみ使用できます。`,
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember | null;
  if (!member) {
    await interaction.reply({ content: "サーバー内で実行してください。", ephemeral: true });
    return;
  }

  await grantVerifyRole(member, (msg) =>
    interaction.reply({ content: msg, ephemeral: true })
  );
}

// プレフィックスコマンド !verify
async function handlePrefixVerify(message: Message): Promise<void> {
  if (message.channelId !== VERIFY_CHANNEL_ID) return;
  if (!message.guild || !message.member) return;

  await grantVerifyRole(message.member, async (msg) => {
    await message.reply(msg).catch(() => {});
  });
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
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("clientReady", async (c) => {
    log(`Bot ready: ${c.user.tag}`);
    await Promise.all([
      registerCommands(c.user.id, token),
      loadVerifyEmoji(c.user.id, token),
    ]);
  });

  // スラッシュコマンド
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (
      interaction.commandName === "tag" &&
      interaction.options.getSubcommand() === "verify"
    ) {
      await handleSlashVerify(interaction).catch((err) =>
        log("handleSlashVerify error", err)
      );
    }
  });

  // プレフィックスコマンド (!verify)
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    const content = message.content.trim().toLowerCase();
    if (content === "!verify") {
      await handlePrefixVerify(message).catch((err) =>
        log("handlePrefixVerify error", err)
      );
    }
  });

  client.on("error", (err) => log("Discord client error", err));

  await client.login(token);
}
