import assert from "node:assert/strict";
import test from "node:test";
import { parsePeriodicReview, type PeriodicReviewSourceEntry } from "../lib/ai/periodic-review";

const entries: PeriodicReviewSourceEntry[] = [
  { id: "entry-a", localDate: "2026-05-03", content: "今天第一次去新的地方，虽然紧张，但我还是走进去了。" },
  { id: "entry-b", localDate: "2026-08-19", content: "这一次我没有马上责怪自己，而是停下来听听心里的声音。" },
];

const valid = {
  overview: "这半年里，新的尝试与自我评价反复交织。前期更常写到面对陌生环境时的紧张，后来开始出现停下来观察自己感受的时刻。",
  themes: [
    {
      title: "走进新的环境",
      observation: "面对紧张时，仍然出现了实际行动。",
      evidence: [{ entryId: "entry-a", localDate: "2026-05-03", quote: "虽然紧张，但我还是走进去了" }],
    },
    {
      title: "看待自己的方式",
      observation: "后期的记录里出现了不立即责怪自己的表达。",
      evidence: [{ entryId: "entry-b", localDate: "2026-08-19", quote: "我没有马上责怪自己" }],
    },
  ],
  turningPoints: [{
    title: "停下来听自己",
    observation: "记录从立刻评价自己，转向先辨认当时的感受。",
    evidence: { entryId: "entry-b", localDate: "2026-08-19", quote: "停下来听听心里的声音" },
  }],
  changes: ["开始允许自己在紧张中继续行动。"],
  unresolved: ["进入陌生环境时的紧张仍会出现。"],
  question: "如果回到这半年的起点，你最想让那时的自己看见哪一点变化？",
};

test("accepts a period review whose evidence is grounded in source entries", () => {
  const result = parsePeriodicReview(valid, entries);
  assert.equal(result.themes.length, 2);
  assert.equal(result.turningPoints[0]!.evidence.entryId, "entry-b");
});

test("rejects a period review with fabricated evidence", () => {
  const fabricated = structuredClone(valid);
  fabricated.themes[0]!.evidence[0]!.quote = "我已经完全不紧张了";
  assert.throws(() => parsePeriodicReview(fabricated, entries), /引用了不存在的日记原文/);
});

test("rejects diagnostic or prescriptive period review language", () => {
  const diagnostic = structuredClone(valid);
  diagnostic.changes[0] = "说明你是焦虑症，你应该尽快改变。";
  assert.throws(() => parsePeriodicReview(diagnostic, entries), /格式无效/);
});
