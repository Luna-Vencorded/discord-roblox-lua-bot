import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../lib/logger.js";

// ─── カンマ区切りで複数キーをサポート ───────────────────────────────────────
function parseKeys(envValue) {
  return (envValue ?? "")
    .split(",")
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

const groqKeys = parseKeys(process.env["GROQ_API_KEY"]);
const geminiKeys = parseKeys(process.env["GEMINI_API_KEY"]);

// ─── Groq: キーを順番に試す ─────────────────────────────────────────────────
async function callGroqWithKeys(system, messages, maxTokens = 2048) {
  let lastErr;
  for (const key of groqKeys) {
    try {
      const groq = new Groq({ apiKey: key });
      const res = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: system
          ? [{ role: "system", content: system }, ...messages]
          : messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      });
      return res.choices[0]?.message?.content ?? "応答を生成できませんでした。";
    } catch (err) {
      const status = err?.status;
      if (status === 429 || status === 503) {
        logger.warn({ keyIndex: groqKeys.indexOf(key), status }, "Groq key rate-limited, trying next key");
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("All Groq keys exhausted");
}

// ─── Gemini: キーを順番に試す ────────────────────────────────────────────────
async function callGeminiWithKeys(system, userText, history = []) {
  let lastErr;
  for (const key of geminiKeys) {
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const chat = model.startChat({
        history: [
          { role: "user", parts: [{ text: system }] },
          { role: "model", parts: [{ text: "了解しました。" }] },
          ...history,
        ],
      });
      const result = await chat.sendMessage(userText);
      return result.response.text() ?? "応答を生成できませんでした。";
    } catch (err) {
      const msg = String(err?.message ?? "");
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
        logger.warn({ keyIndex: geminiKeys.indexOf(key) }, "Gemini key rate-limited, trying next key");
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("All Gemini keys exhausted");
}

// ─── Groq → Gemini フォールバック ───────────────────────────────────────────
async function callAI(system, userText, maxTokens = 2048) {
  if (groqKeys.length > 0) {
    try {
      return await callGroqWithKeys(system, [{ role: "user", content: userText }], maxTokens);
    } catch (groqErr) {
      logger.warn({ err: groqErr }, "All Groq keys failed, falling back to Gemini");
    }
  }
  if (geminiKeys.length > 0) {
    try {
      return await callGeminiWithKeys(system, userText);
    } catch (geminiErr) {
      logger.error({ err: geminiErr }, "All Gemini keys also failed");
    }
  }
  return "AIサービスに接続できませんでした。しばらくしてから再試行してください。";
}

const CHAT_SYSTEM = `あなたはRoblox Luaスクリプトの専門AIアシスタントです。
- Roblox Luaスクリプトの説明・解説
- スクリプトの難読化（obfuscation）
- 難読化されたスクリプトのリバースエンジニアリング（解読）
- スクリプトのバグ修正・改善提案
- Roblox APIやサービスに関する質問への回答
難読化を要求された場合は変数名をランダムな文字列に変換し文字列をエンコードし制御フローを複雑にしてください。
リバースエンジニアリングを要求された場合は難読化されたコードを読みやすい形に変換してください。
常に日本語で回答してください。`;

export async function getAIResponse(userMessage, history) {
  if (groqKeys.length > 0) {
    try {
      const messages = [
        { role: "system", content: CHAT_SYSTEM },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: userMessage },
      ];
      return await callGroqWithKeys("", messages, 2048);
    } catch (groqErr) {
      logger.warn({ err: groqErr }, "All Groq keys failed for chat, falling back to Gemini");
    }
  }
  if (geminiKeys.length > 0) {
    try {
      const geminiHistory = history.map(h => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      }));
      return await callGeminiWithKeys(CHAT_SYSTEM, userMessage, geminiHistory);
    } catch (geminiErr) {
      logger.error({ err: geminiErr }, "All Gemini keys also failed for chat");
    }
  }
  return "AIサービスに接続できませんでした。しばらくしてから再試行してください。";
}

export async function obfuscateLua(code) {
  return callAI(
    "あなたはRoblox Luaスクリプトの難読化専門家です。与えられたLuaコードを難読化してください。変数名をランダムな文字列に変換し、文字列をエンコードし、制御フローを複雑にしてください。難読化されたコードのみを出力してください。説明は不要です。",
    code, 4096,
  );
}

export async function deobfuscateLua(code) {
  return callAI(
    "あなたはRoblox Luaスクリプトのリバースエンジニアリング専門家です。与えられた難読化されたLuaコードを読みやすい形式に変換してください。変数名を意味のある名前に変換し、コードの構造を明確にしてください。解読されたコードと簡単な説明を日本語で出力してください。",
    code, 4096,
  );
}

export async function explainLua(code) {
  return callAI(
    "あなたはRoblox Luaスクリプトの解説専門家です。与えられたLuaスクリプトの機能・仕組みを日本語でわかりやすく解説してください。主要な機能、使用しているRoblox API、潜在的なリスクがあれば指摘してください。",
    code, 2048,
  );
}

export async function fixLua(code) {
  return callAI(
    "あなたはRoblox Luaスクリプトのデバッグ専門家です。与えられたLuaコードのバグを特定し修正してください。修正後のコードと変更点の説明を日本語で出力してください。",
    code, 4096,
  );
}
