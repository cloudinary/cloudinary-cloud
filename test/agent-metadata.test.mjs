import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAgentMetadata } from '../dist/lib/agent-metadata.js';

test('detects framework from agent env markers', () => {
  assert.equal(detectAgentMetadata({ CLAUDECODE: '1' }).agent_framework, 'claude-code');
  assert.equal(detectAgentMetadata({ CURSOR_TRACE_ID: 'x' }).agent_framework, 'cursor');
  assert.equal(detectAgentMetadata({ GEMINI_CLI: '1' }).agent_framework, 'gemini-cli');
});

test('detects the model from common env vars', () => {
  assert.equal(
    detectAgentMetadata({ CLAUDECODE: '1', ANTHROPIC_MODEL: 'claude-fable-5' }).agent_llm_model,
    'claude-fable-5',
  );
});

test('passes the goal through and omits absent fields', () => {
  const metadata = detectAgentMetadata({}, 'add image optimization');
  assert.deepEqual(metadata, { agent_goal: 'add image optimization' });
  assert.deepEqual(detectAgentMetadata({}), {});
});

test('empty env values do not count', () => {
  assert.deepEqual(detectAgentMetadata({ CLAUDECODE: '', ANTHROPIC_MODEL: '' }), {});
});
