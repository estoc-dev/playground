/**
 * A sketch of the proposed era rule for second-order succession, written for
 * this page. It covers the peer's side only: rotations, recoveries and
 * endings the peer signs, seen from one or more local DIDs that do not
 * rotate. Without local rotations no join occurs, so every pair a claim
 * relates sits in one local column and the rule reduces to what follows.
 */

export type Did = string;
export type Channel = { localDid: Did; peerDid: Did };
export type Authority = "key" | "recovery";

export type PeerObservation = {
  kind: "peer-observation";
  at: Channel;
  rotatedFrom: { did: Did; authority: Authority } | null;
};
export type PeerEnding = { kind: "peer-ending"; at: Channel; authority: Authority };
export type Fact = PeerObservation | PeerEnding;

export type Rotation = PeerObservation & { rotatedFrom: { did: Did; authority: Authority } };
export type Claim = Rotation | PeerEnding;

/** Each DID's document `recovery.era`. Only binding reads it; the model does not. */
export type Documents = Readonly<Record<Did, string>>;

export const C = (localDid: Did, peerDid: Did): Channel => ({ localDid, peerDid });
export const pairKey = (channel: Channel) => `${channel.localDid}\u0000${channel.peerDid}`;
export const pairText = (channel: Channel) => `C(${channel.localDid},${channel.peerDid})`;
const unkey = (key: string): Channel => {
  const [localDid, peerDid] = key.split("\u0000") as [Did, Did];
  return { localDid, peerDid };
};

export function factKey(fact: Fact): string {
  const at = [fact.at.localDid, fact.at.peerDid];
  return fact.kind === "peer-ending"
    ? JSON.stringify(["end", at, fact.authority])
    : JSON.stringify(["obs", at, fact.rotatedFrom && [fact.rotatedFrom.did, fact.rotatedFrom.authority]]);
}

export const isRotation = (fact: Fact): fact is Rotation => fact.kind === "peer-observation" && fact.rotatedFrom !== null;
export const isClaim = (fact: Fact): fact is Claim => fact.kind === "peer-ending" || isRotation(fact);
export const authorityOf = (claim: Claim): Authority => (claim.kind === "peer-ending" ? claim.authority : claim.rotatedFrom.authority);

/** The pair a claim's change starts from. */
export const predecessorOf = (claim: Claim): Channel => (claim.kind === "peer-ending" ? claim.at : C(claim.at.localDid, claim.rotatedFrom.did));

/**
 * Binding: a first-order rotation keeps the issuer's era, a second-order one
 * changes it. A fact that fails never reaches the model.
 */
export function binds(fact: Fact, documents: Documents): boolean {
  if (!isRotation(fact)) return true;
  const same = documents[fact.rotatedFrom.did] === documents[fact.at.peerDid];
  return fact.rotatedFrom.authority === "key" ? same : !same;
}

class UnionFind {
  private parent = new Map<string, string>();
  add(key: string) {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }
  find(key: string): string {
    this.add(key);
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(key, root);
    return root;
  }
  union(a: string, b: string) {
    const [ra, rb] = [this.find(a), this.find(b)].sort();
    if (ra !== rb) this.parent.set(rb!, ra!);
  }
  keys() {
    return [...this.parent.keys()];
  }
}

export type Era = { id: string; localDid: Did; members: Did[]; recoveredBy: Claim[] };
export type Relationship = { id: string; localDid: Did; peers: Did[]; claims: Claim[]; eras: Era[] };
export type Link = { from: Channel; to: Channel; authority: Authority; source: Claim; derived: boolean; usable: boolean };
export type Conflict = { kind: "competing-changes" | "era-crossing" | "cycle"; authority: Authority; facts: Claim[]; scope: Channel[] };

export type Status =
  | { status: "usable" }
  | { status: "superseded"; by: Claim[] }
  | { status: "conflict"; facts: Claim[] }
  | { status: "receipt" }
  | { status: "not-counted"; by: Claim[] };

export type HeadResult =
  | { status: "head"; channel: Channel; path: Channel[]; via: Claim[] }
  | { status: "ended"; endings: Claim[]; path: Channel[] }
  | { status: "conflict"; facts: Claim[] }
  | { status: "no-evidence" };

export type ConfirmationResult =
  | { status: "confirmed"; witnesses: Fact[]; notCounted: Fact[] }
  | { status: "unconfirmed"; notCounted: Fact[] }
  | { status: "conflict"; facts: Claim[] };

export type Model = ReturnType<typeof derive>;

export function derive(input: readonly Fact[]) {
  const byKey = new Map<string, Fact>();
  for (const fact of input) byKey.set(factKey(fact), fact);
  const facts = [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, fact]) => fact);
  const claims = facts.filter(isClaim);

  const relationshipOf = new UnionFind();
  const eraOf = new UnionFind();
  for (const claim of claims) {
    const at = pairKey(claim.at);
    const from = pairKey(predecessorOf(claim));
    relationshipOf.union(at, from);
    eraOf.add(at);
    eraOf.add(from);
    if (authorityOf(claim) === "key") eraOf.union(at, from);
  }
  const inRelationship = (channel: Channel) => relationshipOf.keys().includes(pairKey(channel));
  const eraId = (channel: Channel) => eraOf.find(pairKey(channel));
  const predecessorEra = (claim: Claim) => eraId(predecessorOf(claim));

  const recoveries = new Map<string, Claim[]>();
  for (const claim of claims) {
    if (authorityOf(claim) !== "recovery") continue;
    const era = predecessorEra(claim);
    recoveries.set(era, [...(recoveries.get(era) ?? []), claim]);
  }
  const supersededBy = (claim: Claim) => (authorityOf(claim) === "key" ? recoveries.get(predecessorEra(claim)) ?? [] : []);
  const supersededPair = (channel: Channel) => (inRelationship(channel) ? recoveries.get(eraId(channel)) ?? [] : []);
  const active = claims.filter((claim) => supersededBy(claim).length === 0);

  const membersOf = (era: string) => relationshipOf.keys().filter((key) => eraOf.find(key) === era).sort().map(unkey);
  const changeOf = (claim: Claim) => (claim.kind === "peer-ending" ? "end" : `rotate ${claim.at.peerDid}`);
  const successorPairs = (group: readonly Claim[]) => group.filter(isRotation).map((claim) => claim.at);

  const conflicts: Conflict[] = [];
  for (const [era, group] of recoveries) {
    const scope = [...membersOf(era), ...successorPairs(group)];
    if (new Set(group.map(changeOf)).size > 1) conflicts.push({ kind: "competing-changes", authority: "recovery", facts: group, scope });
    for (const claim of group) {
      if (isRotation(claim) && eraId(claim.at) === era) conflicts.push({ kind: "era-crossing", authority: "recovery", facts: [claim], scope });
    }
  }
  const firstOrder = new Map<string, Claim[]>();
  for (const claim of active) {
    if (authorityOf(claim) !== "key") continue;
    const from = pairKey(predecessorOf(claim));
    firstOrder.set(from, [...(firstOrder.get(from) ?? []), claim]);
  }
  for (const [from, group] of firstOrder) {
    if (new Set(group.map(changeOf)).size > 1) conflicts.push({ kind: "competing-changes", authority: "key", facts: group, scope: [unkey(from), ...successorPairs(group)] });
  }

  const links = new Map<string, Omit<Link, "usable">>();
  const addLink = (link: Omit<Link, "usable">) => {
    const key = `${pairKey(link.from)}\u0001${pairKey(link.to)}`;
    const existing = links.get(key);
    if (!existing || (existing.derived && !link.derived)) links.set(key, link);
  };
  for (const claim of active) {
    if (!isRotation(claim)) continue;
    const from = predecessorOf(claim);
    const authority = claim.rotatedFrom.authority;
    addLink({ from, to: claim.at, authority, source: claim, derived: false });
    if (authority === "key") continue;
    for (const member of membersOf(predecessorEra(claim))) {
      if (pairKey(member) !== pairKey(from) && pairKey(member) !== pairKey(claim.at)) addLink({ from: member, to: claim.at, authority, source: claim, derived: true });
    }
  }

  for (const cycle of cycles([...links.values()])) {
    const inside = new Set(cycle);
    const facts = [...new Set([...links.values()].filter((link) => inside.has(pairKey(link.from)) && inside.has(pairKey(link.to))).map((link) => link.source))];
    conflicts.push({ kind: "cycle", authority: facts.some((claim) => authorityOf(claim) === "recovery") ? "recovery" : "key", facts, scope: cycle.map(unkey) });
  }

  const blocked = new Map<string, Set<Claim>>();
  const block = (key: string, because: Iterable<Claim>) => {
    const set = blocked.get(key) ?? new Set<Claim>();
    const before = set.size;
    for (const claim of because) set.add(claim);
    blocked.set(key, set);
    return set.size > before;
  };
  for (const conflict of conflicts) for (const channel of conflict.scope) block(pairKey(channel), conflict.facts);
  const linkUsable = (link: Omit<Link, "usable">) => !blocked.has(pairKey(link.from)) && !blocked.has(pairKey(predecessorOf(link.source)));
  for (let changed = true; changed; ) {
    changed = false;
    const incoming = new Map<string, Omit<Link, "usable">[]>();
    for (const link of links.values()) incoming.set(pairKey(link.to), [...(incoming.get(pairKey(link.to)) ?? []), link]);
    for (const [to, group] of incoming) {
      if (group.some(linkUsable)) continue;
      const because = group.flatMap((link) => [...(blocked.get(pairKey(link.from)) ?? blocked.get(pairKey(predecessorOf(link.source))) ?? [])]);
      if (block(to, because)) changed = true;
    }
  }
  const allLinks: Link[] = [...links.values()].map((link) => ({ ...link, usable: linkUsable(link) }));
  const out = (channel: Channel, usableOnly: boolean) => allLinks.filter((link) => pairKey(link.from) === pairKey(channel) && (!usableOnly || link.usable));

  const reach = (start: Channel, usableOnly: boolean) => {
    const seen = new Map([[pairKey(start), start]]);
    const queue = [start];
    while (queue.length > 0) {
      for (const link of out(queue.shift()!, usableOnly)) {
        if (seen.has(pairKey(link.to))) continue;
        seen.set(pairKey(link.to), link.to);
        queue.push(link.to);
      }
    }
    return [...seen.values()];
  };
  const blockedFacts = (pairs: readonly Channel[]) => [...new Set(pairs.flatMap((channel) => [...(blocked.get(pairKey(channel)) ?? [])]))];

  const endingsAt = (channel: Channel) =>
    active.filter((claim) => claim.kind === "peer-ending" && (claim.authority === "key" ? pairKey(claim.at) === pairKey(channel) : predecessorEra(claim) === eraId(channel)));

  const observedAt = (channel: Channel) => facts.some((fact) => fact.kind === "peer-observation" && pairKey(fact.at) === pairKey(channel));

  function head(channel: Channel): HeadResult {
    if (!inRelationship(channel) && !observedAt(channel)) return { status: "no-evidence" };
    const stuck = blockedFacts(reach(channel, false));
    if (stuck.length > 0) return { status: "conflict", facts: stuck };
    const path = [channel];
    const via: Claim[] = [];
    let current = channel;
    for (;;) {
      const next = [...new Map(out(current, true).map((link) => [pairKey(link.to), link])).values()];
      if (next.length > 1) return { status: "conflict", facts: next.map((link) => link.source) };
      if (next.length === 0) break;
      current = next[0]!.to;
      path.push(current);
      if (!via.includes(next[0]!.source)) via.push(next[0]!.source);
    }
    const endings = endingsAt(current);
    if (endings.length > 0) return { status: "ended", endings, path };
    return { status: "head", channel: current, path, via };
  }

  /** Has the peer, or a usable successor, written to exactly this local DID? Letters on superseded pairs do not count. */
  function confirmation(localDid: Did, peerDid: Did): ConfirmationResult {
    const start = C(localDid, peerDid);
    const stuck = blockedFacts(reach(start, false));
    if (stuck.length > 0) return { status: "conflict", facts: stuck };
    const witnesses: Fact[] = [];
    const notCounted: Fact[] = [];
    for (const channel of reach(start, true)) {
      for (const fact of facts) {
        if (fact.kind !== "peer-observation" || pairKey(fact.at) !== pairKey(channel)) continue;
        (supersededPair(channel).length > 0 ? notCounted : witnesses).push(fact);
      }
    }
    return witnesses.length > 0 ? { status: "confirmed", witnesses, notCounted } : { status: "unconfirmed", notCounted };
  }

  function status(fact: Fact): Status {
    if (!isClaim(fact)) {
      const by = supersededPair(fact.at);
      return by.length > 0 ? { status: "not-counted", by } : { status: "receipt" };
    }
    const involved = conflicts.filter((conflict) => conflict.facts.includes(fact));
    if (involved.length > 0) return { status: "conflict", facts: [...new Set(involved.flatMap((conflict) => conflict.facts))] };
    const by = supersededBy(fact);
    if (by.length > 0) return { status: "superseded", by };
    const stuck = blockedFacts([predecessorOf(fact)]);
    if (stuck.length > 0) return { status: "conflict", facts: stuck };
    return { status: "usable" };
  }

  const relationships: Relationship[] = [];
  const roots = new Set(relationshipOf.keys().map((key) => relationshipOf.find(key)));
  for (const root of [...roots].sort()) {
    const pairs = relationshipOf.keys().filter((key) => relationshipOf.find(key) === root).sort().map(unkey);
    const eraIds = [...new Set(pairs.map(eraId))].sort();
    relationships.push({
      id: root,
      localDid: pairs[0]!.localDid,
      peers: pairs.map((channel) => channel.peerDid),
      claims: claims.filter((claim) => relationshipOf.find(pairKey(claim.at)) === root),
      eras: eraIds.map((id) => ({ id, localDid: pairs[0]!.localDid, members: membersOf(id).map((channel) => channel.peerDid), recoveredBy: recoveries.get(id) ?? [] })),
    });
  }
  const sites = [...new Map(facts.filter((fact) => !inRelationship(fact.at)).map((fact) => [pairKey(fact.at), fact.at])).values()];

  return {
    facts,
    relationships,
    sites,
    links: allLinks,
    conflicts,
    status,
    head,
    confirmation,
    eraOf: (channel: Channel): Era | null => {
      if (!inRelationship(channel)) return null;
      const id = eraId(channel);
      return { id, localDid: channel.localDid, members: membersOf(id).map((pair) => pair.peerDid), recoveredBy: recoveries.get(id) ?? [] };
    },
    supersededPair,
    isBlocked: (channel: Channel) => blocked.has(pairKey(channel)),
  };
}

/** The strongly connected sets of more than one pair, by Tarjan's algorithm. */
function cycles(links: readonly { from: Channel; to: Channel }[]): string[][] {
  const next = new Map<string, string[]>();
  for (const link of links) next.set(pairKey(link.from), [...(next.get(pairKey(link.from)) ?? []), pairKey(link.to)]);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const visit = (key: string) => {
    index.set(key, index.size);
    low.set(key, index.get(key)!);
    stack.push(key);
    onStack.add(key);
    for (const to of next.get(key) ?? []) {
      if (!index.has(to)) {
        visit(to);
        low.set(key, Math.min(low.get(key)!, low.get(to)!));
      } else if (onStack.has(to)) low.set(key, Math.min(low.get(key)!, index.get(to)!));
    }
    if (low.get(key) !== index.get(key)) return;
    const component: string[] = [];
    let popped: string;
    do {
      popped = stack.pop()!;
      onStack.delete(popped);
      component.push(popped);
    } while (popped !== key);
    if (component.length > 1) found.push(component.sort());
  };
  for (const key of [...next.keys()].sort()) if (!index.has(key)) visit(key);
  return found;
}
