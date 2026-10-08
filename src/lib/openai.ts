import OpenAI from "openai";
import { envVar } from "./env";

let client: OpenAI | undefined;

export function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: envVar("OPENAI_API_KEY") });
  return client;
}
