import { C, type Authority, type Channel, type ConfirmationResult, type Did, type Documents, type Fact, type HeadResult, type PeerEnding, type PeerObservation, type Status } from "./model.ts";

export const observe = (localDid: Did, peerDid: Did): PeerObservation => ({ kind: "peer-observation", at: C(localDid, peerDid), rotatedFrom: null });

export const rotated = (localDid: Did, peerDid: Did, from: Did, authority: Authority): PeerObservation => ({
  kind: "peer-observation",
  at: C(localDid, peerDid),
  rotatedFrom: { did: from, authority },
});

export const ended = (localDid: Did, peerDid: Did, authority: Authority): PeerEnding => ({ kind: "peer-ending", at: C(localDid, peerDid), authority });

export type LabelledFact = { label: string; fact: Fact; on: boolean };

/**
 * What the prose around a lab says the sketch answers, for one set of the
 * lab's facts. The tests hold every claim against the sketch, so a change
 * to the rule that alters an answer fails them before the page misleads.
 */
export type Claim = {
  on: readonly string[];
  skipEraCheck?: boolean;
  head?: { at: Channel; status: HeadResult["status"]; to?: Channel };
  confirmation?: { at: Channel; status: ConfirmationResult["status"]; witnesses?: readonly string[] };
  status?: { of: string; status: Status["status"] | "rejected" };
};

export type Scenario = {
  title: string;
  facts: LabelledFact[];
  documents: Documents;
  focus: Channel;
  eraCheck?: boolean;
  claims?: readonly Claim[];
};

const fact = (label: string, value: Fact, on = true): LabelledFact => ({ label, fact: value, on });

const L = (peer: Did) => C("L", peer);

export const labs = {
  eras: {
    title: "One era, one recovery",
    focus: L("C"),
    documents: { A: "7f3a", B: "7f3a", C: "7f3a", D: "c21e" },
    facts: [fact("f1", rotated("L", "B", "A", "key")), fact("f2", rotated("L", "C", "B", "key")), fact("r", rotated("L", "D", "A", "recovery"), false)],
    claims: [
      { on: ["f1", "f2"], head: { at: L("A"), status: "head", to: L("C") } },
      { on: ["f1", "f2", "r"], head: { at: L("C"), status: "head", to: L("D") } },
      { on: ["f1", "f2", "r"], head: { at: L("B"), status: "head", to: L("D") } },
      { on: ["f1", "f2", "r"], status: { of: "f2", status: "superseded" } },
    ],
  },
  fork: {
    title: "A fork the key cannot settle",
    focus: L("A"),
    documents: { A: "7f3a", B: "7f3a", C: "7f3a", D: "c21e" },
    facts: [fact("f1", rotated("L", "B", "A", "key")), fact("f2", rotated("L", "C", "A", "key")), fact("r", rotated("L", "D", "A", "recovery"), false)],
    claims: [
      { on: ["f1", "f2"], head: { at: L("A"), status: "conflict" } },
      { on: ["f1", "f2"], head: { at: L("B"), status: "conflict" } },
      { on: ["f1", "f2", "r"], head: { at: L("A"), status: "head", to: L("D") } },
      { on: ["f1", "f2", "r"], head: { at: L("C"), status: "head", to: L("D") } },
      { on: ["f1", "f2", "r"], status: { of: "f1", status: "superseded" } },
    ],
  },
  siblings: {
    title: "Recoveries in order and in competition",
    focus: L("A"),
    documents: { A: "7f3a", D: "c21e", F: "05b9", G: "e64d" },
    facts: [fact("r1", rotated("L", "D", "A", "recovery")), fact("r2", rotated("L", "F", "D", "recovery")), fact("r3", rotated("L", "G", "A", "recovery"), false)],
    claims: [
      { on: ["r1", "r2"], head: { at: L("A"), status: "head", to: L("F") } },
      { on: ["r1", "r2"], status: { of: "r1", status: "usable" } },
      { on: ["r1", "r2", "r3"], head: { at: L("A"), status: "conflict" } },
      { on: ["r1", "r2", "r3"], head: { at: L("F"), status: "conflict" } },
      { on: ["r1", "r2", "r3"], status: { of: "r2", status: "conflict" } },
    ],
  },
  oldKeys: {
    title: "What an old key can still do",
    focus: L("B"),
    documents: { A: "7f3a", B: "7f3a", D: "c21e", T: "7f3a" },
    facts: [
      fact("f1", rotated("L", "B", "A", "key")),
      fact("r", rotated("L", "D", "A", "recovery")),
      fact("o1", observe("L", "B"), false),
      fact("t", rotated("L", "T", "B", "key"), false),
      fact("o2", observe("M", "B"), false),
    ],
    claims: [
      { on: ["f1", "t"], head: { at: L("B"), status: "head", to: L("T") } },
      { on: ["f1", "r", "t"], head: { at: L("T"), status: "head", to: L("D") } },
      { on: ["f1", "r", "t"], status: { of: "t", status: "superseded" } },
      { on: ["f1", "r", "o1"], head: { at: L("B"), status: "head", to: L("D") } },
      { on: ["f1", "r", "o1"], status: { of: "o1", status: "not-counted" } },
      { on: ["f1", "r", "o1"], confirmation: { at: L("B"), status: "confirmed", witnesses: ["r"] } },
      { on: ["f1", "r", "o2"], confirmation: { at: C("M", "B"), status: "confirmed", witnesses: ["o2"] } },
      { on: ["f1", "r", "o2"], head: { at: C("M", "B"), status: "head", to: C("M", "B") } },
    ],
  },
  binding: {
    title: "A late first-order claim",
    focus: L("A"),
    eraCheck: true,
    documents: { A: "7f3a", D: "c21e", E: "c21e", F: "05b9" },
    facts: [
      fact("r1", rotated("L", "D", "A", "recovery")),
      fact("f", rotated("L", "E", "D", "key")),
      fact("r2", rotated("L", "F", "E", "recovery")),
      fact("x", rotated("L", "E", "A", "key")),
    ],
    claims: [
      { on: ["r1", "f", "r2", "x"], head: { at: L("A"), status: "head", to: L("F") } },
      { on: ["r1", "f", "r2", "x"], status: { of: "x", status: "rejected" } },
      { on: ["r1", "f", "r2", "x"], skipEraCheck: true, head: { at: L("A"), status: "conflict" } },
      { on: ["r1", "f", "r2", "x"], skipEraCheck: true, head: { at: L("F"), status: "conflict" } },
      { on: ["r1", "f", "r2", "x"], skipEraCheck: true, status: { of: "x", status: "superseded" } },
    ],
  },
} satisfies Record<string, Scenario>;

export type LabName = keyof typeof labs;

export const presets: Record<string, Scenario> = {
  empty: { title: "Start from one pair", focus: L("A"), documents: { A: "7f3a" }, facts: [fact("o1", observe("L", "A"))] },
  eras: labs.eras,
  fork: labs.fork,
  siblings: labs.siblings,
  oldKeys: labs.oldKeys,
  binding: labs.binding,
  cycle: {
    title: "A cycle, then a recovery",
    focus: L("A"),
    documents: { A: "7f3a", B: "7f3a", D: "c21e" },
    facts: [fact("f1", rotated("L", "B", "A", "key")), fact("f2", rotated("L", "A", "B", "key")), fact("r", rotated("L", "D", "A", "recovery"), false)],
    claims: [
      { on: ["f1", "f2"], head: { at: L("A"), status: "conflict" } },
      { on: ["f1", "f2", "r"], head: { at: L("B"), status: "head", to: L("D") } },
    ],
  },
  ending: {
    title: "A recovery that ends the relationship",
    focus: L("B"),
    documents: { A: "7f3a", B: "7f3a" },
    facts: [fact("f1", rotated("L", "B", "A", "key")), fact("e", ended("L", "A", "recovery"))],
    claims: [
      { on: ["f1", "e"], head: { at: L("B"), status: "ended" } },
      { on: ["f1", "e"], status: { of: "f1", status: "superseded" } },
    ],
  },
  bridge: {
    title: "A later claim reveals a fork",
    focus: L("A"),
    documents: { A: "7f3a", B: "7f3a", D: "c21e", E: "e64d" },
    facts: [fact("r1", rotated("L", "D", "A", "recovery")), fact("r2", rotated("L", "E", "B", "recovery")), fact("f", rotated("L", "B", "A", "key"), false)],
    claims: [
      { on: ["r1", "r2"], head: { at: L("A"), status: "head", to: L("D") } },
      { on: ["r1", "r2"], head: { at: L("B"), status: "head", to: L("E") } },
      { on: ["r1", "r2", "f"], head: { at: L("A"), status: "conflict" } },
    ],
  },
};
