import type { Channel, ContinuityFact, Did, LocalDecision, PeerEnding, PeerObservation } from "@estoc/continuity";

export const C = (localDid: Did, peerDid: Did): Channel => ({ localDid, peerDid });

export const observe = (localDid: Did, peerDid: Did): PeerObservation => ({ kind: "peer-observation", at: C(localDid, peerDid), rotatedFrom: null });

export const rotated = (localDid: Did, peerDid: Did, from: Did): PeerObservation => ({ kind: "peer-observation", at: C(localDid, peerDid), rotatedFrom: from });

export const peerEnd = (localDid: Did, peerDid: Did): PeerEnding => ({ kind: "peer-ending", at: C(localDid, peerDid) });

export const decide = (localDid: Did, peerDid: Did, successor: Did): LocalDecision => ({
  kind: "local-decision",
  at: C(localDid, peerDid),
  change: { kind: "rotate", successor },
});

export const localEnd = (localDid: Did, peerDid: Did): LocalDecision => ({ kind: "local-decision", at: C(localDid, peerDid), change: { kind: "end" } });

export const pairText = (channel: Channel) => `C(${channel.localDid},${channel.peerDid})`;

export const channelKey = (channel: Channel) => `${channel.localDid}\u0000${channel.peerDid}`;

/** The same key, in a form an attribute value can hold. */
export const domKey = (channel: Channel) => `${encodeURIComponent(channel.localDid)} ${encodeURIComponent(channel.peerDid)}`;

export function describe(fact: ContinuityFact): string {
  const { localDid, peerDid } = fact.at;
  switch (fact.kind) {
    case "peer-observation":
      return fact.rotatedFrom === null ? `${peerDid} wrote to ${localDid}` : `${peerDid} wrote to ${localDid}, carrying ${fact.rotatedFrom} → ${peerDid}`;
    case "peer-ending":
      return `${peerDid} ended, in a proof sent to ${localDid}`;
    case "local-decision":
      return fact.change.kind === "rotate"
        ? `You saved ${localDid} → ${fact.change.successor} at ${pairText(fact.at)}`
        : `You saved an ending at ${pairText(fact.at)}`;
  }
}

/** The pairs a fact mentions: where it sits, and the pair a rotation leaves or names. */
export function pairsOf(fact: ContinuityFact): Channel[] {
  const pairs = [fact.at];
  if (fact.kind === "peer-observation" && fact.rotatedFrom !== null) pairs.push(C(fact.at.localDid, fact.rotatedFrom));
  if (fact.kind === "local-decision" && fact.change.kind === "rotate") pairs.push(C(fact.change.successor, fact.at.peerDid));
  return pairs;
}

export type Tone = "observation" | "peer" | "local" | "ending";

export function toneOf(fact: ContinuityFact): Tone {
  if (fact.kind === "peer-observation") return fact.rotatedFrom === null ? "observation" : "peer";
  if (fact.kind === "peer-ending") return "ending";
  return fact.change.kind === "rotate" ? "local" : "ending";
}
