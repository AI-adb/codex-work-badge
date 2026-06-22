import { parseOutcomeLedgerJsonl } from "./outcomes";

it("parses only public-safe ledger fields and redacts dangerous text", () => {
  const fakeOpenAiKey = ["sk", "proj", "abc1234567890"].join("-");
  const entries = parseOutcomeLedgerJsonl(
    JSON.stringify({
      date: "2026-06-21",
      artifact: "Badge /Users/anthony/private",
      bugsResolved: 3,
      artifactsShipped: 1,
      gatesPassed: 4,
      proof: `No ${fakeOpenAiKey} leaked`,
      publicSafe: true
    })
  );

  expect(entries[0].bugsResolved).toBe(3);
  expect(entries[0].label).toContain("[private]");
  expect(entries[0].proof).toContain("[private]");
});
