/*
 * Try a candidate agent with only an ElevenLabs key: no Supabase, no OpenAI, no frontend.
 * Builds the agent from a fixture with exactly the backend's config, then you talk to it in the
 * ElevenLabs dashboard ("Test AI agent").
 *
 *   npm run try:agent -- alex-novak [--difficulty tough]   create or update the agent, print its link
 *   npm run try:agent -- alex-novak --feelings             keep the reportFeeling client tool (the backend's
 *                                                          config; breaks ElevenLabs' test pages, which can't handle it)
 *   npm run try:agent -- alex-novak --transcript           print the latest conversation with it
 *   npm run try:agent -- alex-novak --delete               delete the agent
 *
 * Needs ELEVENLABS_API_KEY in .env.local (Agents: write, Voices: read).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

// Fallback voice when the persona's voice gives no gender (the backend uses ELEVENLABS_DEFAULT_VOICE_ID).
process.env.ELEVENLABS_DEFAULT_VOICE_ID ||= "SAz9YHcvj6GT2YYXdXww";

const API = "https://api.elevenlabs.io";

async function el<T>(p: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${p}`, {
    ...init,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`ElevenLabs ${init.method ?? "GET"} ${p} failed (${res.status}): ${(await res.text()).slice(0, 800)}`);
  return res.json() as Promise<T>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is missing in .env.local");
  const slug = process.argv[2];
  if (!slug || slug.startsWith("--")) throw new Error("Usage: npm run try:agent -- <fixture-slug> [--difficulty tough] [--transcript] [--delete]");

  const { PersonaProfile } = await import("../src/lib/persona");
  const { CandidateBrief, Difficulty } = await import("../src/lib/candidate");
  const { createPersonaAgent, updatePersonaAgent, deleteAgent, getConversation } = await import("../src/lib/elevenlabs");
  const { pickVoice } = await import("../src/lib/voices");

  const raw = JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "candidates", `${slug}.json`), "utf8"));
  const profile = PersonaProfile.parse(raw.profile);
  const candidate = CandidateBrief.parse(raw.candidate);
  const name = `Persona: ${profile.display_name}`;

  // Find the agent this script made before, by name, so re-runs update it.
  const { agents } = await el<{ agents: { agent_id: string; name: string }[] }>(
    `/v1/convai/agents?page_size=100&search=${encodeURIComponent(name)}`,
  );
  const existing = agents.find((a) => a.name === name);

  if (process.argv.includes("--delete")) {
    if (!existing) return console.log(`No agent named "${name}"`);
    await deleteAgent(existing.agent_id);
    return console.log(`Deleted ${existing.agent_id}`);
  }

  if (process.argv.includes("--transcript")) {
    if (!existing) throw new Error(`No agent named "${name}". Create it first.`);
    const { conversations } = await el<{ conversations: { conversation_id: string }[] }>(
      `/v1/convai/conversations?agent_id=${existing.agent_id}&page_size=1`,
    );
    if (!conversations.length) return console.log("No conversations yet. Talk to the agent in the dashboard first.");
    const convo = await getConversation(conversations[0].conversation_id);
    console.log(`Conversation ${convo.conversation_id} (${convo.status}, ${convo.metadata?.call_duration_secs ?? "?"} s)\n`);
    for (const t of convo.transcript as (typeof convo.transcript[number] & { tool_calls?: { tool_name: string; params_as_json: string }[] })[]) {
      const who = t.role === "user" ? "HR       " : "Candidate";
      if (t.message) console.log(`[${t.time_in_call_secs ?? 0}s] ${who}: ${t.message}`);
      for (const call of t.tool_calls ?? []) console.log(`[${t.time_in_call_secs ?? 0}s]   ↳ ${call.tool_name} ${call.params_as_json}`);
    }
    return;
  }

  const voice = pickVoice(profile.voice) ?? process.env.ELEVENLABS_DEFAULT_VOICE_ID!;
  // ElevenLabs' test pages end the call on an unknown client tool, so leave it out unless asked.
  // Public so the ElevenLabs test page and /meet?agent=… can call it without a backend token.
  const opts = { feelingTool: process.argv.includes("--feelings"), publicAccess: true };
  let agentId = existing?.agent_id;
  if (agentId) await updatePersonaAgent(agentId, profile, voice, candidate, opts);
  else agentId = await createPersonaAgent(profile, voice, candidate, opts);

  // The dashboard test has no way to pass dynamic variables, so set the default difficulty on the agent.
  const difficulty = Difficulty.parse(arg("difficulty") ?? "realistic");
  await el(`/v1/convai/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      conversation_config: { agent: { dynamic_variables: { dynamic_variable_placeholders: { difficulty } } } },
    }),
  });

  console.log(`${existing ? "Updated" : "Created"} agent for ${profile.display_name} (${candidate.target_role})`);
  console.log(`  agent:      ${agentId}`);
  console.log(`  voice:      ${voice}`);
  console.log(`  difficulty: ${difficulty}`);
  console.log(`  feelings:   ${opts.feelingTool ? "reportFeeling tool on (needs a client that handles it)" : "off"}`);
  const meet = new URLSearchParams({ agent: agentId, fixture: slug, name: profile.display_name, role: candidate.target_role });
  console.log(`\nTalk to it (allow the microphone; after the greeting, you lead the interview):`);
  if (opts.feelingTool) {
    console.log(`  Meet UI (npm run dev): http://localhost:4000/meet?${meet}`);
    console.log(`  Feedback after the call needs OPENAI_API_KEY in .env.local.`);
  } else {
    console.log(`  https://elevenlabs.io/app/talk-to?agent_id=${agentId}`);
    console.log(`  or the dashboard's "Test AI agent": https://elevenlabs.io/app/agents/agents/${agentId}`);
  }
  console.log(`\nAfterwards: npm run try:agent -- ${slug} --transcript`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
