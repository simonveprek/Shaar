import { z } from "zod";

// Request bodies, shared by the route handlers (validation) and the API catalog (docs).

export const Target = z.object({
  platform: z.string().describe("Platform key from GET /api/connectors, like `instagram`."),
  target: z.string().trim().min(1).max(500).describe("Handle (`@natgeo`) or profile URL."),
  maxPosts: z.number().int().min(1).max(500).optional().describe("Posts to fetch for this target. Default 30."),
});

export const CreateJob = z.object({
  subjectName: z.string().trim().min(1).max(200).describe("Who is being researched. Shown in the UI and given to the model."),
  notes: z.string().max(2000).optional().describe("Extra context for the persona model, like their job or why you are researching them."),
  targets: z.array(Target).min(1).max(20).describe("One entry per profile to scrape, 1 to 20."),
});

export const RunConnector = z.object({
  target: z.string().trim().min(1).max(500).describe("Handle or profile URL on this platform."),
  maxPosts: z.number().int().min(1).max(500).optional().describe("Posts to fetch. Default 30."),
  jobId: z.uuid().optional().describe("Add this source to an existing job (its persona is rebuilt). Omit to create a new job."),
  subjectName: z.string().trim().min(1).max(200).optional().describe("Name for the new job when `jobId` is omitted. Defaults to `target`."),
});

export const StartInterview = z.object({
  voiceId: z.string().min(1).optional().describe("ElevenLabs voice ID. Defaults to the persona's last voice or ELEVENLABS_DEFAULT_VOICE_ID."),
  transport: z
    .enum(["webrtc", "websocket"])
    .default("webrtc")
    .describe("`webrtc` returns `session.conversationToken`. `websocket` returns `session.signedUrl`."),
});

export const Chat = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20_000) }))
    .min(1)
    .max(50)
    .describe("The conversation so far, oldest first. The last message is usually from `user`."),
  jobId: z.uuid().optional().describe("Ground answers in this research job's persona."),
});

export const Tts = z.object({
  text: z.string().trim().min(1).max(5000).describe("Text to speak (max 5000 chars)."),
  voiceId: z.string().min(1).optional().describe("ElevenLabs voice ID. Defaults to ELEVENLABS_DEFAULT_VOICE_ID."),
  modelId: z.string().min(1).optional().describe("ElevenLabs TTS model. Defaults to ELEVENLABS_TTS_MODEL."),
});

export const StartDiscovery = z.object({
  name: z.string().trim().min(2).max(120).describe("The person's full name, as typed."),
  purpose: z.string().trim().max(200).optional().describe("What the visitor chose to do, saved with the search and later as the job's notes."),
});
