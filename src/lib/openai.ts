import OpenAI from "openai";
import { need } from "./env";

let client: OpenAI | undefined;

export function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: need("OPENAI_API_KEY", "OpenAI") });
  return client;
}
