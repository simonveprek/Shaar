import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { Chat } from "@/lib/schemas";
import { handle, maybe, readJson } from "@/lib/http";
import { openai } from "@/lib/openai";
import { getJob, type PersonaRow } from "@/lib/research";
import { db } from "@/lib/supabase";

const BASE_INSTRUCTIONS =
  "You are a research assistant in a social media deep research app. Answer concisely and say when the research data does not cover a question.";

/** Streams the assistant's reply as plain text chunks. Read it with `response.body.getReader()`. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  const body = await readJson(req, Chat);

  let instructions = BASE_INSTRUCTIONS;
  if (body.jobId) {
    const job = await getJob(body.jobId, user.id);
    const persona = maybe(await db().from("personas").select().eq("job_id", job.id).maybeSingle<PersonaRow>());
    instructions += `\n\nResearch subject: ${job.subject_name}.`;
    if (persona?.profile) instructions += `\nPersona built from their public posts:\n${JSON.stringify(persona.profile)}`;
  }

  const stream = await openai().responses.create({
    model: env().OPENAI_CHAT_MODEL,
    instructions,
    input: body.messages,
    stream: true,
    store: false,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") controller.enqueue(encoder.encode(event.delta));
          if (event.type === "error") throw new Error(event.message);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      stream.controller.abort();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
});
