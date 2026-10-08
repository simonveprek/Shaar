import OpenAI from "openai";
import { env } from "./env";

let client: OpenAI | undefined;

export function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: env().OPENAI_API_KEY });
  return client;
}
