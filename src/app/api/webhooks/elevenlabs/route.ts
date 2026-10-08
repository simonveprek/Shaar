import { env } from "@/lib/env";
import { handle, HttpError, maybe } from "@/lib/http";
import { verifyWebhookSignature } from "@/lib/elevenlabs";
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

  let event: PostCallEvent;
  try {
    event = JSON.parse(raw) as PostCallEvent;
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
  if (event.type !== "post_call_transcription") return Response.json({ ok: true, ignored: event.type });
  if (!event.data?.conversation_id) throw new HttpError(400, "Missing data.conversation_id");

  const interview = maybe(
    await db()
      .from("interviews")
      .select("id")
      .eq("elevenlabs_conversation_id", event.data.conversation_id)
      .maybeSingle<{ id: string }>(),
  );
  if (!interview) return Response.json({ ok: true, ignored: "unknown conversation" });

  await applyConversation(interview.id, { ...event.data, status: event.data.status || "done" });
  return Response.json({ ok: true });
});
