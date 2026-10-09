import type { Channel, ConfirmationResult, ContinuityFact, Did, HeadResult } from "@estoc/continuity";
import { C, decide, localEnd, observe, peerEnd, rotated } from "./facts.ts";

export type LabelledFact = { label: string; fact: ContinuityFact; on: boolean };

/**
 * What the prose around a lab says the model answers, for one set of the
 * lab's facts. The tests hold every claim against the published model, so
 * a release that changes an answer fails them before the page misleads.
 */
export type Claim = {
  on: readonly string[];
  head?: { at: Channel; status: HeadResult["status"]; to?: Channel };
  confirmation?: { localDid: Did; peerDid: Did; status: ConfirmationResult["status"] };
};

export type Scenario = {
  title: string;
  facts: LabelledFact[];
  focus: Channel;
  claims?: readonly Claim[];
};

const fact = (label: string, value: ContinuityFact, on = true): LabelledFact => ({ label, fact: value, on });

const A0B0 = C("A0", "B0");
const A0B1 = C("A0", "B1");
const A1B0 = C("A1", "B0");
const A1B1 = C("A1", "B1");

export const labs = {
  peer: {
    title: "A peer rotation",
    focus: A0B0,
    facts: [fact("p1", rotated("A0", "B1", "B0")), fact("x", observe("X0", "B0"), false)],
    claims: [
      { on: ["p1"], head: { at: A0B0, status: "head", to: A0B1 } },
      { on: ["p1"], confirmation: { localDid: "A0", peerDid: "B0", status: "confirmed" } },
      { on: ["p1", "x"], head: { at: C("X0", "B0"), status: "head", to: C("X0", "B0") } },
    ],
  },
  local: {
    title: "A local rotation",
    focus: A0B0,
    facts: [
      fact("d1", decide("A0", "B0", "A1")),
      fact("o0", observe("A0", "B0"), false),
      fact("o1", observe("A1", "B0"), false),
      fact("p1", rotated("A0", "B1", "B0"), false),
    ],
    claims: [
      { on: ["d1"], head: { at: A0B0, status: "unresolved" } },
      { on: ["d1", "o0"], head: { at: A0B0, status: "head", to: A1B0 } },
      { on: ["d1", "o1"], head: { at: A0B0, status: "unresolved" } },
      { on: ["d1", "p1"], head: { at: A0B0, status: "head", to: A1B1 } },
    ],
  },
  join: {
    title: "Both sides rotate",
    focus: A0B0,
    facts: [
      fact("o0", observe("A0", "B0")),
      fact("d1", decide("A0", "B0", "A1")),
      fact("p1", rotated("A0", "B1", "B0")),
      fact("o2", observe("A1", "B1"), false),
    ],
    claims: [
      { on: ["o0", "d1", "p1"], head: { at: A0B0, status: "head", to: A1B1 } },
      { on: ["o0", "d1", "p1"], head: { at: A1B0, status: "head", to: A1B1 } },
      { on: ["o0", "d1", "p1"], head: { at: A0B1, status: "head", to: A1B1 } },
      { on: ["o0", "d1", "p1"], confirmation: { localDid: "A1", peerDid: "B1", status: "unconfirmed" } },
      { on: ["o0", "d1", "p1", "o2"], confirmation: { localDid: "A1", peerDid: "B1", status: "confirmed" } },
    ],
  },
  fork: {
    title: "Two replicas meet",
    focus: A0B0,
    facts: [
      fact("o0", observe("A0", "B0")),
      fact("d1", decide("A0", "B0", "A1")),
      fact("p1", rotated("A0", "B1", "B0")),
      fact("p2", rotated("A1", "B2", "B0"), false),
    ],
    claims: [
      { on: ["o0", "d1", "p1"], head: { at: A0B0, status: "head", to: A1B1 } },
      { on: ["o0", "d1", "p1", "p2"], head: { at: A0B0, status: "conflict" } },
      { on: ["o0", "d1", "p1", "p2"], head: { at: A1B1, status: "conflict" } },
    ],
  },
  ending: {
    title: "An ending",
    focus: A1B0,
    facts: [
      fact("o0", observe("A0", "B0")),
      fact("d1", decide("A0", "B0", "A1")),
      fact("e", peerEnd("A0", "B0")),
      fact("p1", rotated("A0", "B1", "B0"), false),
    ],
    claims: [
      { on: ["o0", "d1", "e"], head: { at: A1B0, status: "ended" } },
      { on: ["o0", "d1", "e"], head: { at: A0B0, status: "ended" } },
      { on: ["o0", "d1", "e", "p1"], head: { at: A1B0, status: "conflict" } },
    ],
  },
} satisfies Record<string, Scenario>;

export type LabName = keyof typeof labs;

const forkAbove = [fact("f1", rotated("A0", "Bp", "Bz")), fact("f2", rotated("A0", "Bq", "Bz"))];
const unusablyConfirmed = [...forkAbove, fact("s", rotated("A0", "B0", "Bp")), fact("d", decide("A0", "B0", "A1"))];
const elsewhere = [
  fact("x1", decide("X0", "B0", "A0")),
  fact("x2", decide("X0", "B1", "A0")),
  fact("x3", rotated("X0", "B2", "B0")),
  fact("x4", rotated("X0", "B2", "B1")),
  fact("o", observe("A0", "B1")),
  fact("i", decide("A0", "B1", "A1")),
];

export const presets: Record<string, Scenario> = {
  empty: { title: "Start from one pair", focus: A0B0, facts: [fact("o0", observe("A0", "B0"))] },
  join: { ...labs.join, title: "Both sides rotate" },
  replicas: { ...labs.fork, facts: labs.fork.facts.map((item) => ({ ...item, on: true })), title: "Two replicas meet" },
  localFork: {
    title: "Two saved successors",
    focus: A0B0,
    facts: [fact("d1", decide("A0", "B0", "A1")), fact("d2", decide("A0", "B0", "A2"))],
    claims: [{ on: ["d1", "d2"], head: { at: A0B0, status: "conflict" } }],
  },
  localEnd: {
    title: "You end while the peer rotates",
    focus: A0B1,
    facts: [fact("e", localEnd("A0", "B0")), fact("p1", rotated("A0", "B1", "B0"))],
    claims: [{ on: ["e", "p1"], head: { at: A0B1, status: "ended" } }],
  },
  cycle: {
    title: "A cycle",
    focus: A0B0,
    facts: [fact("p1", rotated("A0", "B1", "B0")), fact("p2", rotated("A0", "B0", "B1"))],
    claims: [{ on: ["p1", "p2"], head: { at: A0B0, status: "conflict" } }],
  },
  collision: {
    title: "A join that would pair a DID with itself",
    focus: A0B0,
    facts: [fact("o0", observe("A0", "B0")), fact("d1", decide("A0", "B0", "A1")), fact("p1", rotated("A0", "A1", "B0"))],
    claims: [{ on: ["o0", "d1", "p1"], head: { at: A0B0, status: "conflict" } }],
  },
  hops: {
    title: "A witness across two hops",
    focus: A0B0,
    facts: [fact("p1", rotated("A0", "B1", "B0")), fact("p2", rotated("A0", "B2", "B1")), fact("d1", decide("A0", "B0", "A1"))],
    claims: [{ on: ["p1", "p2", "d1"], head: { at: A0B0, status: "head", to: C("A1", "B2") } }],
  },
  diagnostic: {
    title: "A link only the positive graph has",
    focus: A0B0,
    facts: unusablyConfirmed,
    claims: [{ on: ["f1", "f2", "s", "d"], head: { at: A0B0, status: "conflict" } }],
  },
  covered: {
    title: "The same change, made usable elsewhere",
    focus: A0B0,
    facts: [...unusablyConfirmed, ...elsewhere],
    claims: [{ on: [...unusablyConfirmed, ...elsewhere].map((item) => item.label), head: { at: A0B0, status: "head", to: C("A1", "B2") } }],
  },
  onward: {
    title: "An onward rotation on a side branch",
    focus: A0B0,
    facts: [...unusablyConfirmed, ...elsewhere, fact("w", decide("A1", "B0", "A2"))],
    claims: [{ on: [...unusablyConfirmed, ...elsewhere, { label: "w" }].map((item) => item.label), head: { at: A0B0, status: "conflict" } }],
  },
};
