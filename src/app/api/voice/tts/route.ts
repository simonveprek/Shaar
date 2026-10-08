import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { handle, readJson } from "@/lib/http";
import { textToSpeech } from "@/lib/elevenlabs";

const Tts = z.object({
  text: z.string().trim().min(1).max(5000),
  voiceId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});

/** Text to speech. Returns streaming audio/mpeg, playable via `new Audio(URL.createObjectURL(blob))`. */
export const POST = handle(async (req: Request) => {
  await requireUser(req);
  const body = await readJson(req, Tts);
  const audio = await textToSpeech(body.text, body.voiceId ?? env().ELEVENLABS_DEFAULT_VOICE_ID, body.modelId);
  return new Response(audio.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
});
