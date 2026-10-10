import assert from "node:assert/strict";
import test from "node:test";
import { parseReflection } from "../lib/ai/analysis";
import { parseConversationReply } from "../lib/ai/conversation";

test("accepts a grounded reflection with an exact quote", () => {
  const result = parseReflection({
    highRisk: false,
    observations: [{ text: "你同时写到了疲惫和完成后的轻松。", evidence: "终于做完了，虽然很累" }],
    question: "这份轻松对你来说更像结束，还是新的开始？",
  }, "今天终于做完了，虽然很累，但心里松了一口气。");

  assert.equal(result.kind, "reflection");
  if (result.kind === "reflection") assert.equal(result.observations.at(0)?.evidence, "终于做完了，虽然很累");
});

test("rejects fabricated evidence", () => {
  assert.throws(() => parseReflection({
    highRisk: false,
    observations: [{ text: "你感到轻松。", evidence: "我非常开心" }],
    question: null,
  }, "今天终于做完了。"), /不存在/);
});

test("rejects diagnosis and prescriptive language", () => {
  assert.throws(() => parseReflection({
    highRisk: false,
    observations: [{ text: "说明你是焦虑症，你应该休息。", evidence: "我有点担心" }],
    question: null,
  }, "我有点担心明天的事情。"), /越过了回望边界/);
});

test("uses a fixed safety response rather than model-authored advice", () => {
  const result = parseReflection({ highRisk: true, observations: [], question: null }, "测试内容");
  assert.equal(result.kind, "safety");
  if (result.kind === "safety") assert.match(result.message, /联系身边可信任的人/);
});

test("accepts one grounded conversational question", () => {
  assert.equal(
    parseConversationReply({ highRisk: false, response: "你提到这件事让疲惫浮了出来。那份疲惫最早是什么时候开始变明显的？" }),
    "你提到这件事让疲惫浮了出来。那份疲惫最早是什么时候开始变明显的？",
  );
});

test("rejects diagnostic or interrogating conversation replies", () => {
  assert.throws(() => parseConversationReply({ highRisk: false, response: "说明你是焦虑症。为什么？后来呢？" }), /越过了回望边界/);
  assert.throws(() => parseConversationReply({ highRisk: false, response: "发生了什么？你当时怎么想？" }), /太多问题/);
});
