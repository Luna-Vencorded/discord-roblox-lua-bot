const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

async function translateWithOpenRouter(text: string, context: "title" | "description"): Promise<string> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) return text;

  const systemPrompt = context === "title"
    ? "あなたはゲームスクリプトの専門翻訳者です。英語のスクリプトタイトルを自然な日本語に翻訳してください。短く簡潔に。"
    : "あなたはゲームスクリプトの専門翻訳者です。英語の説明文を自然な日本語に翻訳してください。";

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-flash-1.5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      max_tokens: 300,
    }),
  });

  if (!res.ok) return text;

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() ?? text;
}

export async function translateTitle(title: string): Promise<string> {
  if (!title?.trim()) return title;
  const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(title);
  if (isJapanese) return title;
  try { return await translateWithOpenRouter(title, "title"); } catch { return title; }
}

export async function translateDescription(description: string): Promise<string> {
  if (!description?.trim()) return description;
  const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(description);
  if (isJapanese) return description;
  try { return await translateWithOpenRouter(description, "description"); } catch { return description; }
}
