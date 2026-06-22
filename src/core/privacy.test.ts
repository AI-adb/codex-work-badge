import { createBadgeManifest } from "./badge";
import { assertPublicManifestSafe, findForbiddenPublicData } from "./privacy";
import { sampleAggregate, sampleOutcomes } from "./sample";

it("rejects public badge manifests containing sensitive values", () => {
  const manifest = createBadgeManifest(sampleAggregate, sampleOutcomes);
  const fakeOpenAiKey = ["sk", "proj", "abc1234567890"].join("-");
  const unsafe = {
    ...manifest,
    caption: `Built in /Users/anthony/private with ${fakeOpenAiKey}`
  };

  expect(findForbiddenPublicData(unsafe)).toContain("absolute macOS path");
  expect(() => assertPublicManifestSafe(unsafe)).toThrow(/forbidden public data/);
});

it("does not flag the safe sample manifest", () => {
  const manifest = createBadgeManifest(sampleAggregate, sampleOutcomes);
  expect(findForbiddenPublicData(manifest)).toEqual([]);
});
