import assert from "node:assert/strict";
import test from "node:test";
import { parseReflection } from "../lib/ai/analysis";
import { parseConversationReply } from "../lib/ai/conversation";

function structuredFeedback() {
  return {
    highRisk: false,
    breakdown: {
      facts: [],
      feelings: [{ text: "你写到了紧张。", evidence: "我很紧张", inferred: false }],
      guesses: [],
      needs: [{ text: "可能希望有一点安定感，待你确认。", evidence: "我很紧张", inferred: true }],
    },
    smallStep: { action: "如果愿意，可以让肩膀自然放松，保持一个舒服的姿势 30 秒，到时间就结束。", evidence: "我很紧张", durationSeconds: 30 },
  };
}

test("structured reflection preserves quotes and labels inferred needs", () => {
  const result = parseReflection(structuredFeedback(), "我很紧张", true);
  assert.equal(result.kind, "reflection");
  if (result.kind !== "reflection") return;
  assert.equal(result.breakdown?.feelings[0]?.evidence, "我很紧张");
  assert.equal(result.breakdown?.needs[0]?.inferred, true);
  assert.equal(result.smallStep?.durationSeconds, 30);
});

test("structured generation rejects missing categories, invented quotes and inferred facts", () => {
  const value = structuredFeedback();
  assert.throws(() => parseReflection({ ...value, breakdown: {} }, "我很紧张", true));
  assert.throws(() => parseReflection(value, "今天还不错", true), /不存在/);
  assert.throws(() => parseReflection({ ...value, breakdown: { ...value.breakdown, facts: value.breakdown.needs } }, "我很紧张", true), /推测标记/);
  assert.throws(() => parseReflection({ highRisk: false, observations: [{ text: "紧张", evidence: "紧张" }] }, "我很紧张", true), /分类格式/);
});

test("small action must be singular, bounded and grounded", () => {
  const value = structuredFeedback();
  for (const smallStep of [
    [value.smallStep],
    { ...value.smallStep, durationSeconds: 600 },
    { ...value.smallStep, evidence: "我很孤单" },
    { ...value.smallStep, action: "你必须立即振作" },
  ]) assert.throws(() => parseReflection({ ...value, smallStep }, "我很紧张", true), /小行动/);
});

test("personality labels are rejected in interpretation but quotes remain verbatim", () => {
  const value = structuredFeedback();
  value.breakdown.feelings[0] = { text: "你是回避型", evidence: "我很紧张", inferred: false };
  assert.throws(() => parseReflection(value, "我很紧张", true), /边界/);
  value.breakdown.feelings[0] = { text: "你提到对自己的判断。", evidence: "我是回避型吗", inferred: false };
  assert.equal(parseReflection(value, "我很紧张，我是回避型吗", true).kind, "reflection");
});

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
