import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deriveContinuity } from "@estoc/continuity";
import { labs, presets, type Scenario } from "../src/continuity/scenarios.ts";

function check(name: string, scenario: Scenario) {
  describe(name, () => {
    for (const claim of scenario.claims ?? []) {
      const facts = claim.on.map((label) => {
        const found = scenario.facts.find((item) => item.label === label);
        assert.ok(found, `no fact labelled ${label}`);
        return found.fact;
      });
      const model = deriveContinuity(facts);
      const { head, confirmation } = claim;
      if (head) {
        test(`with ${claim.on.join(", ")}, the head of C(${head.at.localDid},${head.at.peerDid}) is ${head.status}`, () => {
          const result = model.head(head.at);
          assert.equal(result.status, head.status);
          if (head.to && result.status === "head") assert.deepEqual(result.channel, head.to);
        });
      }
      if (confirmation) {
        test(`with ${claim.on.join(", ")}, ${confirmation.peerDid} writing to ${confirmation.localDid} is ${confirmation.status}`, () => {
          assert.equal(model.confirmation(confirmation.localDid, confirmation.peerDid).status, confirmation.status);
        });
      }
    }
  });
}

for (const [name, scenario] of Object.entries(labs)) check(`lab ${name}`, scenario);
for (const [name, scenario] of Object.entries(presets)) check(`preset ${name}`, scenario);

test("every lab starts from facts the model accepts", () => {
  for (const scenario of [...Object.values(labs), ...Object.values(presets)]) deriveContinuity(scenario.facts.map((item) => item.fact));
});
