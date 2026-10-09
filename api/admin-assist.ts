// POST /api/admin-assist  { conversationId: number, mode: "draft" | "summary" }
// Admin-only: returns an AI-drafted reply or a summary of a conversation.

import { authUser, db } from "./_lib/supabase.js";
import { generate } from "./_lib/ai.js";
import { ADMIN_DRAFT_PROMPT, ADMIN_SUMMARY_PROMPT } from "./_lib/knowledge.js";

const PER_MIN = Number(process.env.AI_RATE_LIMIT_PER_MIN) || 6;

// Cheap per-instance throttle for admin assists (admins are few and trusted).
const recent = new Map<string, number[]>();

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: "Please sign in again." });

    const [admin] = await db(`profiles?id=eq.${user.id}&select=role,municipality,municipality_access`);
    if (admin?.role !== "admin") return res.status(403).json({ error: "Admins only." });

    const now = Date.now();
    const hits = (recent.get(user.id) || []).filter(t => now - t < 60_000);
    if (hits.length >= PER_MIN) return res.status(429).json({ error: "Too many requests. Wait a moment." });
    recent.set(user.id, [...hits, now]);

    const id = Number(req.body?.conversationId);
    const mode = req.body?.mode === "summary" ? "summary" : "draft";
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad conversation id." });

    const [conv] = await db(`support_conversations?id=eq.${id}&select=id,municipality`);
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    const allowed = !conv.municipality
      || admin.municipality === conv.municipality
      || (admin.municipality_access || []).includes(conv.municipality);
    if (!allowed) return res.status(403).json({ error: "Not your municipality." });

    const msgs = await db(
      `support_messages?conversation_id=eq.${id}&select=sender,body&order=created_at.desc&limit=30`);
    msgs.reverse();

    let text: string;
    if (mode === "summary") {
      const transcript = msgs.map((m: any) => `${m.sender.toUpperCase()}: ${m.body}`).join("\n");
      text = await generate(ADMIN_SUMMARY_PROMPT, [{ role: "user", content: transcript }]);
    } else {
      const turns = msgs.map((m: any) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.body,
      }));
      if (!turns.length || turns[turns.length - 1].role !== "user") {
        turns.push({ role: "user", content: "(Write a helpful follow-up reply for the admin to send.)" });
      }
      text = await generate(ADMIN_DRAFT_PROMPT, turns);
    }
    return res.status(200).json({ text });
  } catch (e) {
    console.error("[admin-assist]", e);
    return res.status(500).json({ error: "The AI assistant is unavailable right now." });
  }
}
