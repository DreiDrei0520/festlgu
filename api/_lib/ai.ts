// Provider-agnostic text generation. Switch provider with env vars only:
//   AI_PROVIDER = anthropic | openai | gemini
//   AI_API_KEY  = key for that provider
//   AI_MODEL    = optional model override
// Uses plain fetch (no SDK dependency). Server-side only.

export type ChatTurn = { role: "user" | "assistant"; content: string };

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-5-5",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

const MAX_OUTPUT_TOKENS = 600;

// Providers need strictly alternating turns that start with "user".
function normalize(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += "\n\n" + t.content;
    else out.push({ ...t });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`AI provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function generate(system: string, turns: ChatTurn[]): Promise<string> {
  const provider = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error("AI_API_KEY is not set");
  const model = process.env.AI_MODEL || DEFAULT_MODELS[provider];
  if (!model) throw new Error(`Unknown AI_PROVIDER "${provider}"`);
  const msgs = normalize(turns);
  if (!msgs.length) throw new Error("No user message to answer");

  let text = "";
  if (provider === "anthropic") {
    const data = await post("https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      { model, max_tokens: MAX_OUTPUT_TOKENS, system, messages: msgs });
    text = (data.content || []).map((c: any) => c.text || "").join("");
  } else if (provider === "openai") {
    const data = await post("https://api.openai.com/v1/chat/completions",
      { authorization: `Bearer ${key}` },
      { model, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: "system", content: system }, ...msgs] });
    text = data.choices?.[0]?.message?.content || "";
  } else if (provider === "gemini") {
    const data = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": key },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: msgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      });
    text = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
  } else {
    throw new Error(`Unknown AI_PROVIDER "${provider}"`);
  }
  text = text.trim();
  if (!text) throw new Error("Empty AI response");
  return text;
}
