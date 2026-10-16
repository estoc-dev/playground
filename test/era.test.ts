import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { binds, derive, factKey, pairKey, type Fact } from "../src/era/model.ts";
import { labs, presets, type Scenario } from "../src/era/scenarios.ts";

function admitted(scenario: Scenario, labels: readonly string[], skipEraCheck: boolean): Fact[] {
  return labels.map((label) => {
    const found = scenario.facts.find((item) => item.label === label);
    assert.ok(found, `no fact labelled ${label}`);
    return found.fact;
  }).filter((fact) => skipEraCheck || binds(fact, scenario.documents));
}

function check(name: string, scenario: Scenario) {
  describe(name, () => {
    for (const claim of scenario.claims ?? []) {
      const skip = claim.skipEraCheck === true;
      const facts = admitted(scenario, claim.on, skip);
      const model = derive(facts);
      const given = `with ${claim.on.join(", ")}${skip ? " and no era check" : ""}`;
      const labelOf = (fact: Fact) => scenario.facts.find((item) => factKey(item.fact) === factKey(fact))?.label;
      const { head, confirmation, status } = claim;
      if (head) {
        test(`${given}, the head of C(${head.at.localDid},${head.at.peerDid}) is ${head.status}`, () => {
          const result = model.head(head.at);
          assert.equal(result.status, head.status);
          if (head.to && result.status === "head") assert.equal(pairKey(result.channel), pairKey(head.to));
        });
      }
      if (confirmation) {
        test(`${given}, confirmation at C(${confirmation.at.localDid},${confirmation.at.peerDid}) is ${confirmation.status}`, () => {
          const result = model.confirmation(confirmation.at.localDid, confirmation.at.peerDid);
          assert.equal(result.status, confirmation.status);
          if (confirmation.witnesses && result.status === "confirmed") assert.deepEqual(result.witnesses.map(labelOf).sort(), [...confirmation.witnesses].sort());
        });
      }
      if (status) {
        test(`${given}, ${status.of} is ${status.status}`, () => {
          const item = scenario.facts.find((entry) => entry.label === status.of)!;
          const actual = !skip && !binds(item.fact, scenario.documents) ? "rejected" : model.status(item.fact).status;
          assert.equal(actual, status.status);
        });
      }
    }
  });
}

for (const [name, scenario] of Object.entries(labs)) check(`lab ${name}`, scenario);
const inLabs = new Set<Scenario>(Object.values(labs));
for (const [name, scenario] of Object.entries(presets)) if (!inLabs.has(scenario)) check(`preset ${name}`, scenario);

test("the answers do not depend on the order facts arrive in", () => {
  for (const scenario of [...Object.values(labs), ...Object.values(presets)]) {
    const facts = scenario.facts.map((item) => item.fact);
    const forward = derive(facts);
    const backward = derive([...facts].reverse().concat(facts.slice(0, 1)));
    const pairs = forward.relationships.flatMap((relationship) => relationship.peers.map((peerDid) => ({ localDid: relationship.localDid, peerDid })));
    for (const pair of [...pairs, ...forward.sites]) assert.deepEqual(backward.head(pair), forward.head(pair));
  }
});

test("a plain letter on a superseded pair changes no answer", () => {
  const { facts } = labs.oldKeys;
  const base = derive(["f1", "r"].map((label) => facts.find((item) => item.label === label)!.fact));
  const withLetter = derive(["f1", "r", "o1"].map((label) => facts.find((item) => item.label === label)!.fact));
  for (const peerDid of ["A", "B", "D"]) assert.deepEqual(withLetter.head({ localDid: "L", peerDid }), base.head({ localDid: "L", peerDid }));
});
