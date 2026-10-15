import assert from "node:assert/strict";
import test from "node:test";
import {
  batchByCharacterLimit,
  parsePeriodicReview,
  type PeriodicReviewSourceEntry,
} from "../lib/ai/periodic-review";

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

test("restores punctuation variants to the exact source quote", () => {
  const punctuationVariant = structuredClone(valid);
  punctuationVariant.themes[0]!.evidence[0]!.quote = "虽然紧张, 但我还是走进去了";
  const result = parsePeriodicReview(punctuationVariant, entries);
  assert.equal(result.themes[0]!.evidence[0]!.quote, "虽然紧张，但我还是走进去了");
});

test("resolves final review evidence from server-issued IDs", () => {
  const indexed = structuredClone(valid) as unknown as Record<string, unknown>;
  const themes = indexed.themes as Array<Record<string, unknown>>;
  const turningPoints = indexed.turningPoints as Array<Record<string, unknown>>;
  themes[0]!.evidence = [{ evidenceId: "e0" }];
  themes[1]!.evidence = [{ evidenceId: "e1" }];
  turningPoints[0]!.evidence = { evidenceId: "e2" };
  const result = parsePeriodicReview(indexed, entries, new Map([
    ["e0", { entryId: "entry-a", localDate: "2026-05-03", quote: "虽然紧张，但我还是走进去了" }],
    ["e1", { entryId: "entry-b", localDate: "2026-08-19", quote: "我没有马上责怪自己" }],
    ["e2", { entryId: "entry-b", localDate: "2026-08-19", quote: "停下来听听心里的声音" }],
  ]));
  assert.equal(result.themes[0]!.evidence[0]!.quote, "虽然紧张，但我还是走进去了");
});

test("rejects final review evidence IDs not issued by the server", () => {
  const indexed = structuredClone(valid);
  indexed.themes[0]!.evidence = [{ evidenceId: "invented" }] as never;
  assert.throws(() => parsePeriodicReview(indexed, entries, new Map()), /没有可核验的主题证据/);
});

test("drops a fabricated theme while retaining other grounded themes", () => {
  const fabricated = structuredClone(valid);
  fabricated.themes[0]!.evidence[0]!.quote = "我已经完全不紧张了";
  const result = parsePeriodicReview(fabricated, entries);
  assert.equal(result.themes.length, 1);
  assert.equal(result.themes[0]!.title, "看待自己的方式");
});

test("rejects diagnostic or prescriptive period review language", () => {
  const diagnostic = structuredClone(valid);
  diagnostic.changes[0] = "说明你是焦虑症，你应该尽快改变。";
  assert.throws(() => parsePeriodicReview(diagnostic, entries), /格式无效/);
});

test("allows sensitive words when they are verified quotations from the journal", () => {
  const sourceEntries: PeriodicReviewSourceEntry[] = [{
    id: "entry-sensitive",
    localDate: "2026-09-08",
    content: "那天我反复问自己：我应该怎么办？后来还在网上搜索了焦虑症三个字。",
  }];
  const review = {
    overview: "这篇记录保留了当时反复寻找答案的过程。",
    themes: [{
      title: "寻找答案",
      observation: "记录中出现了对下一步方向的反复追问。",
      evidence: [{
        entryId: "entry-sensitive",
        localDate: "2026-09-08",
        quote: "我应该怎么办",
      }],
    }],
    changes: [],
    unresolved: [],
    question: null,
  };
  const result = parsePeriodicReview(review, sourceEntries);
  assert.equal(result.themes[0]!.evidence[0]!.quote, "我应该怎么办");
});

test("tolerates missing optional arrays and truncates harmless overlong fields", () => {
  const flexible = structuredClone(valid) as unknown as Record<string, unknown>;
  flexible.turningPoints = undefined;
  flexible.changes = undefined;
  flexible.unresolved = undefined;
  flexible.question = { unexpected: true };
  const themes = flexible.themes as Array<Record<string, unknown>>;
  themes[0]!.title = "一".repeat(80);
  const result = parsePeriodicReview(flexible, entries);
  assert.equal(result.themes[0]!.title.length, 40);
  assert.deepEqual(result.turningPoints, []);
  assert.deepEqual(result.changes, []);
  assert.equal(result.question, undefined);
});

test("batches long review material without dropping or reordering summaries", () => {
  const summaries = [
    { summary: "一".repeat(40) },
    { summary: "二".repeat(40) },
    { summary: "三".repeat(40) },
    { summary: "四".repeat(40) },
  ];
  const batches = batchByCharacterLimit(summaries, 100);
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), summaries);
  assert.ok(batches.every((batch) => batch.length > 0));
});

test("keeps one oversized summary in its own batch", () => {
  const oversized = { summary: "很长".repeat(100) };
  assert.deepEqual(batchByCharacterLimit([oversized], 20), [[oversized]]);
});
