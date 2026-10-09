// POST /api/chat  { message: string }
// Authenticated user -> saves their message, and (unless the conversation is
// escalated to a human) replies with the AI assistant. Rate-limited per user.

import { authUser, db } from "./_lib/supabase.js";
import { generate } from "./_lib/ai.js";
import { USER_SYSTEM_PROMPT, FALLBACK_ERROR_MESSAGE, RATE_LIMIT_MESSAGE } from "./_lib/knowledge.js";

const PER_MIN = Number(process.env.AI_RATE_LIMIT_PER_MIN) || 6;
const PER_DAY = Number(process.env.AI_RATE_LIMIT_PER_DAY) || 100;
const MAX_LEN = 1000;
const HISTORY = 12;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: "Please sign in again." });

    const message = String(req.body?.message ?? "").trim().slice(0, MAX_LEN);
    if (!message) return res.status(400).json({ error: "Message is empty." });

    // One conversation per user (created on first message).
    let [conv] = await db(`support_conversations?user_id=eq.${user.id}&select=*`);
    if (!conv) {
      const [p] = await db(`profiles?id=eq.${user.id}&select=municipality`);
      [conv] = await db("support_conversations", {
        method: "POST",
        body: { user_id: user.id, municipality: p?.municipality || null },
      });
    }

    // Rate limit: count this user's own messages (the table is the counter).
    const since = (ms: number) => encodeURIComponent(new Date(Date.now() - ms).toISOString());
    const count = async (ms: number) => {
      const rows = await db(
        `support_messages?conversation_id=eq.${conv.id}&sender=eq.user&created_at=gte.${since(ms)}&select=id`);
      return rows.length;
    };
    if ((await count(60_000)) >= PER_MIN || (await count(86_400_000)) >= PER_DAY) {
      return res.status(429).json({ error: RATE_LIMIT_MESSAGE });
    }

    await db("support_messages", {
      method: "POST",
      body: { conversation_id: conv.id, sender: "user", sender_id: user.id, body: message },
    });

    // A human is handling this one — no bot reply.
    if (conv.status === "escalated") return res.status(200).json({ escalated: true });

    const history = await db(
      `support_messages?conversation_id=eq.${conv.id}&select=sender,body&order=created_at.desc&limit=${HISTORY}`);
    const turns = history.reverse().map((m: any) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.body,
    }));

    let reply: string;
    let failed = false;
    try {
      reply = await generate(USER_SYSTEM_PROMPT, turns);
    } catch (e) {
      console.error("[chat] AI error:", e);
      reply = FALLBACK_ERROR_MESSAGE;
      failed = true;
    }
    await db("support_messages", {
      method: "POST",
      body: { conversation_id: conv.id, sender: "bot", body: reply },
    });
    return res.status(200).json({ ok: !failed, error: failed ? FALLBACK_ERROR_MESSAGE : undefined });
  } catch (e) {
    console.error("[chat]", e);
    return res.status(500).json({ error: FALLBACK_ERROR_MESSAGE });
  }
}
