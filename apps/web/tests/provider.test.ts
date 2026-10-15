import assert from "node:assert/strict";
import test from "node:test";
import { providerRequestExtras } from "../lib/ai/provider";

test("disables DeepSeek thinking for structured JSON completions", () => {
  assert.deepEqual(providerRequestExtras("deepseek"), { thinking: { type: "disabled" } });
});

test("does not send DeepSeek-specific options to compatible providers", () => {
  assert.deepEqual(providerRequestExtras("openai-compatible"), {});
});
