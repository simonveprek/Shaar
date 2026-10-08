import type { PersonaProfile } from "./persona";

/*
 * Voice selection for candidate personas. Gender comes from the persona that OpenAI builds from the scraped
 * data (`profile.voice.gender_presentation`), age from `profile.voice.age_sound`. Male and female personas get
 * a matching ElevenLabs premade voice (available in every account); neutral/unknown fall back to
 * ELEVENLABS_DEFAULT_VOICE_ID. The frontend can always override with `voiceId`.
 */
type Age = "young" | "middle_aged" | "old";

const VOICES: Record<"male" | "female", Record<Age, string>> = {
  male: {
    young: "bIHbv24MWmeRgasZH58o", // Will: relaxed
    middle_aged: "iP95p4xoKVk53GoZ742B", // Chris: down-to-earth
    old: "pqHfZKP75CvOlQylNhV4", // Bill: mature, balanced
  },
  female: {
    young: "cgSgspJ2msm6clMCkdW9", // Jessica: bright, warm
    middle_aged: "hpp4J3VqNfWAUOO0d1Us", // Bella: professional, warm
    old: "Xb7hH8MSUJpSbSDYk0k2", // Alice: clear, mature
  },
};

/** A stock voice matching the persona's gender and age, or null when the persona gives no gender. */
export function pickVoice(voice: PersonaProfile["voice"]): string | null {
  const gender = voice.gender_presentation;
  if (gender !== "male" && gender !== "female") return null;
  const age: Age = voice.age_sound === "unknown" ? "middle_aged" : voice.age_sound;
  return VOICES[gender][age];
}
