import { compareUtf8, deriveContinuity, type Channel, type Continuity, type ContinuityFact, type Did, type FactStatus, type PositiveLink } from "@estoc/continuity";
import { C, channelKey, pairsOf } from "./facts.ts";

/** A saved local rotation the positive graph does not hold yet: drawn as a claim toward the pair it names. */
export type Claim = { from: Channel; to: Channel; fact: ContinuityFact; status: FactStatus };

export type View = {
  model: Continuity;
  locals: Did[];
  peers: Did[];
  channels: Channel[];
  links: PositiveLink[];
  claims: Claim[];
  conflictScope: Set<string>;
};

/**
 * The DIDs one side rotates through, laid out by rank so that most
 * rotations span one row or column: a DID sits one rank after its latest
 * predecessor, and a DID nothing rotates into sits just before its first
 * successor. Ties and cycles are broken by name.
 */
function order(dids: Iterable<Did>, edges: [Did, Did][]): Did[] {
  const pending = new Set(dids);
  const incoming = new Map<Did, number>([...pending].map((did) => [did, 0]));
  for (const [, to] of edges) incoming.set(to, (incoming.get(to) ?? 0) + 1);
  const topo: Did[] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter((did) => incoming.get(did) === 0).sort(compareUtf8);
    const next = ready[0] ?? [...pending].sort(compareUtf8)[0]!;
    pending.delete(next);
    topo.push(next);
    for (const [from, to] of edges) if (from === next && pending.has(to)) incoming.set(to, incoming.get(to)! - 1);
  }
  const index = new Map(topo.map((did, i) => [did, i]));
  const forward = edges.filter(([from, to]) => index.get(from)! < index.get(to)!);
  const rank = new Map(topo.map((did) => [did, 0]));
  for (const did of topo) for (const [from, to] of forward) if (from === did) rank.set(to, Math.max(rank.get(to)!, rank.get(from)! + 1));
  for (const did of [...topo].reverse()) {
    if (forward.some(([, to]) => to === did)) continue;
    const successors = forward.filter(([from]) => from === did).map(([, to]) => rank.get(to)!);
    if (successors.length > 0) rank.set(did, Math.min(...successors) - 1);
  }
  return topo.sort((a, b) => rank.get(a)! - rank.get(b)! || index.get(a)! - index.get(b)!);
}

export function buildView(facts: readonly ContinuityFact[]): View {
  const model = deriveContinuity(facts);
  const channels = new Map<string, Channel>();
  const add = (channel: Channel) => channels.set(channelKey(channel), channel);
  for (const fact of model.facts) for (const pair of pairsOf(fact)) add(pair);

  const links = new Map<string, PositiveLink>();
  for (const channel of [...channels.values()]) {
    for (const link of model.history(channel).links) {
      links.set(`${channelKey(link.from)}\u0001${channelKey(link.to)}`, link);
      add(link.from);
      add(link.to);
    }
  }

  const claims: Claim[] = [];
  for (const fact of model.facts) {
    if (fact.kind !== "local-decision" || fact.change.kind !== "rotate") continue;
    const to = C(fact.change.successor, fact.at.peerDid);
    if (!links.has(`${channelKey(fact.at)}\u0001${channelKey(to)}`)) claims.push({ from: fact.at, to, fact, status: model.status(fact) });
  }

  const conflictScope = new Set<string>();
  for (const conflict of model.conflicts()) for (const channel of conflict.scope) conflictScope.add(channelKey(channel));

  const all = [...channels.values()];
  const localEdges: [Did, Did][] = [];
  const peerEdges: [Did, Did][] = [];
  for (const link of links.values()) {
    if (link.replaces === "local") localEdges.push([link.from.localDid, link.to.localDid]);
    else peerEdges.push([link.from.peerDid, link.to.peerDid]);
  }
  for (const claim of claims) localEdges.push([claim.from.localDid, claim.to.localDid]);

  return {
    model,
    locals: order(new Set(all.map((channel) => channel.localDid)), localEdges),
    peers: order(new Set(all.map((channel) => channel.peerDid)), peerEdges),
    channels: all,
    links: [...links.values()],
    claims,
    conflictScope,
  };
}
