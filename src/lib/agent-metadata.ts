/**
 * Agent attribution metadata — EXPERIMENTAL and deliberately self-contained.
 *
 * The create request includes best-effort `agent_framework` / `agent_llm_model`
 * / `agent_goal` fields so provisioning can be attributed to the agent that
 * drove it, mirroring the agent signup API. The endpoint accepts unknown
 * fields, so this is safe to send whether or not the server processes them.
 *
 * To remove the experiment entirely: delete this file, the `--goal` /
 * `--no-agent-metadata` flags in args.ts, and the single call site in
 * commands/create.ts.
 */

export interface AgentMetadata extends Record<string, string | undefined> {
  agent_framework?: string;
  agent_llm_model?: string;
  agent_goal?: string;
}

/** Env markers set by AI coding agents in their subshells, best known first. */
const FRAMEWORK_MARKERS: Array<{ framework: string; env: string }> = [
  { framework: 'claude-code', env: 'CLAUDECODE' },
  { framework: 'claude-code', env: 'CLAUDE_CODE_ENTRYPOINT' },
  { framework: 'cursor', env: 'CURSOR_TRACE_ID' },
  { framework: 'cursor', env: 'CURSOR_AGENT' },
  { framework: 'codex', env: 'CODEX_SANDBOX' },
  { framework: 'codex', env: 'CODEX_HOME' },
  { framework: 'gemini-cli', env: 'GEMINI_CLI' },
  { framework: 'opencode', env: 'OPENCODE' },
  { framework: 'amp', env: 'AMP_SESSION_ID' },
  { framework: 'windsurf', env: 'WINDSURF_SESSION' },
];

/** Env vars agents commonly use to name the active model. */
const MODEL_VARS = ['ANTHROPIC_MODEL', 'CLAUDE_MODEL', 'OPENAI_MODEL', 'GEMINI_MODEL'];

export function detectAgentMetadata(
  env: NodeJS.ProcessEnv = process.env,
  goal?: string,
): AgentMetadata {
  const metadata: AgentMetadata = {};

  const marker = FRAMEWORK_MARKERS.find(m => env[m.env]);
  if (marker) metadata.agent_framework = marker.framework;

  const modelVar = MODEL_VARS.find(v => env[v]);
  if (modelVar) metadata.agent_llm_model = env[modelVar];

  if (goal) metadata.agent_goal = goal;

  return metadata;
}
