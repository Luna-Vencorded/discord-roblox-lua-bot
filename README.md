# Scriptblox Discord Bot

scriptblox.com のスクリプトを Discord フォーラムチャンネルに自動投稿するボット。

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DISCORD_BOT_TOKEN` | ✅ | Discord ボットトークン |
| `OPENROUTER_API_KEY` | 任意 | 日本語翻訳用 (なければ英語のまま) |
| `GUILD_ID` | 任意 | デフォルト: `1476104535683371202` |
| `CHANNEL_ID` | 任意 | デフォルト: `1515622353114107984` |
| `POST_INTERVAL_MS` | 任意 | 投稿間隔ms (デフォルト: `10000`) |

## コマンド

| コマンド | 説明 |
|---------|------|
| `!go` | 投稿開始 |
| `!stop` | 投稿停止 |
| `!debug` | チャンネル・権限確認 |

## Railway へのデプロイ

1. このリポジトリを Railway に接続
2. 環境変数を設定（`DISCORD_BOT_TOKEN`, `OPENROUTER_API_KEY`）
3. 自動でビルド・起動されます

## 動作

- scriptblox.com を全ページスキャンして未投稿スクリプトを順次投稿（10秒間隔）
- タイトル・説明を日本語に翻訳
- ゲーム名・Universal・Key・Patched などのタグを自動付与
- 1時間ごとに閲覧数を更新
- 投稿済みは `data/posted_scripts.json` で管理（重複投稿なし）
