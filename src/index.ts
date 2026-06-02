import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot/index.js";
import { createGitHubRepo, pushFileToGitHub } from "./bot/github.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

startBot();

(async () => {
  const repoUrl = await createGitHubRepo();
  if (repoUrl) {
    logger.info({ repoUrl }, "GitHub repo ready");
    await uploadBotFilesToGitHub();
  }
})();

async function uploadBotFilesToGitHub(): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const __dirname = dirname(fileURLToPath(import.meta.url));

  const files: { path: string; fsPath: string }[] = [
    { path: "src/bot/index.ts", fsPath: resolve(__dirname, "bot/index.js") },
    { path: "src/bot/ai.ts", fsPath: resolve(__dirname, "bot/ai.js") },
    { path: "src/bot/scriptblox.ts", fsPath: resolve(__dirname, "bot/scriptblox.js") },
    { path: "src/bot/github.ts", fsPath: resolve(__dirname, "bot/github.js") },
  ];

  const readme = `# Discord Roblox Lua Bot

A Discord bot that provides Roblox Lua script search and AI assistance.

## Features

- \`!search_{script name}\` — Search Roblox scripts from ScriptBlox
- \`/set\` — Set the current channel as AI auto-response channel
- AI chat: Roblox Lua obfuscation, reverse engineering, Q&A (Groq + Gemini)

## Supported Server & Channel

- Server: \`1490495338296115364\`
- Channel: \`1510354846111371377\`

## Environment Variables

\`\`\`
DISCORD_BOT_TOKEN=
GROQ_API_KEY=
GEMINI_API_KEY=
GITHUB_TOKEN=
\`\`\`

## Usage

\`\`\`bash
pnpm install
pnpm run dev
\`\`\`
`;

  await pushFileToGitHub("README.md", readme, "Add README");

  for (const f of files) {
    try {
      const content = await readFile(f.fsPath, "utf-8");
      await pushFileToGitHub(f.path, content, `Add ${f.path}`);
    } catch {
      // built file may not exist at startup; skip
    }
  }
}
