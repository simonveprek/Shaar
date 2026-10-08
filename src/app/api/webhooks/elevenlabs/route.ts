import { env } from "@/lib/env";
import { handle, maybe } from "@/lib/http";
import { verifyWebhookSignature } from "@/lib/elevenlabs";
import { startFeedback } from "@/lib/feedback";
import { applyConversation } from "@/lib/interviews";
import { db } from "@/lib/supabase";

type PostCallEvent = {
  type: string;
  data: {
    conversation_id: string;
    status: string;
    transcript?: unknown[];
    analysis?: Record<string, unknown> | null;
    metadata?: { call_duration_secs?: number };
  };
};

/** ElevenLabs post-call webhook: stores the finished interview's transcript and analysis. */
export const POST = handle(async (req: Request) => {
  const secret = env().ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook secret not configured" }, { status: 503 });

  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("elevenlabs-signature"), secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as PostCallEvent;
  if (event.type !== "post_call_transcription") return Response.json({ ok: true, ignored: event.type });

  const interview = maybe(
    await db()
      .from("interviews")
      .select("id")
      .eq("elevenlabs_conversation_id", event.data.conversation_id)
      .maybeSingle<{ id: string }>(),
  );
  if (!interview) return Response.json({ ok: true, ignored: "unknown conversation" });

  const updated = await applyConversation(interview.id, { ...event.data, status: event.data.status || "done" });
  // Starting is quick (OpenAI runs it in the background); GET /api/interviews/:id collects the result.
  await startFeedback(updated);
  return Response.json({ ok: true });
});
