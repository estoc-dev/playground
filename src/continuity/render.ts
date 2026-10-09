import type { Channel, ContinuityFact, PositiveLink } from "@estoc/continuity";
import { channelKey, domKey, pairText } from "./facts.ts";
import type { Claim, View } from "./view.ts";

const NS = "http://www.w3.org/2000/svg";
const COLUMN = 176;
const ROW = 112;
const LEFT = 52;
const TOP = 44;
const NODE_W = 108;
const NODE_H = 48;

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  for (const child of children) node.append(child);
  return node;
}

export type Marks = {
  selected: Channel | null;
  head: Channel | null;
  path: readonly Channel[];
  highlight: ReadonlySet<string>;
};

export type Draw = {
  view: View;
  label: (fact: ContinuityFact) => string;
  marks: Marks;
  onSelect: (channel: Channel) => void;
};

const ARROWS = ["local", "peer", "diagnostic", "waiting", "conflict"] as const;

export function drawLattice({ view, label, marks, onSelect }: Draw): SVGSVGElement {
  const column = new Map(view.locals.map((did, index) => [did, index]));
  const row = new Map(view.peers.map((did, index) => [did, index]));
  const x = (channel: Channel) => LEFT + column.get(channel.localDid)! * COLUMN + COLUMN / 2;
  const y = (channel: Channel) => TOP + row.get(channel.peerDid)! * ROW + ROW / 2;
  const width = LEFT + view.locals.length * COLUMN + 8;
  const height = TOP + view.peers.length * ROW + 4;
  const occupied = new Set(view.channels.map(channelKey));

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: "lattice", role: "group" });
  svg.style.setProperty("--natural-width", `${width}px`);
  svg.append(
    el(
      "defs",
      {},
      ...ARROWS.map((kind) =>
        el("marker", { id: `arrow-${kind}`, class: `arrow arrow-${kind}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" }, el("path", { d: "M0 0 L10 5 L0 10 z" })),
      ),
    ),
  );

  const axes = el("g", { class: "axes", "aria-hidden": "true" });
  axes.append(el("text", { x: 4, y: 16, class: "axis-title local" }, "you →"), el("text", { x: 4, y: 32, class: "axis-title peer" }, "peer ↓"));
  view.locals.forEach((did, index) => axes.append(el("text", { x: LEFT + index * COLUMN + COLUMN / 2, y: 24, class: "axis local", "text-anchor": "middle" }, did)));
  view.peers.forEach((did, index) => axes.append(el("text", { x: LEFT - 10, y: TOP + index * ROW + ROW / 2 + 4, class: "axis peer", "text-anchor": "end" }, did)));
  svg.append(axes);

  const onPath = new Set<string>();
  for (let i = 1; i < marks.path.length; i++) onPath.add(`${channelKey(marks.path[i - 1]!)}\u0001${channelKey(marks.path[i]!)}`);

  const edges = el("g", { class: "edges" });
  const labels = el("g", { class: "edge-labels" });
  const between = (from: Channel, to: Channel) => {
    if (from.peerDid === to.peerDid) {
      const [a, b] = [column.get(from.localDid)!, column.get(to.localDid)!].sort((m, n) => m - n);
      return view.locals.slice(a! + 1, b).filter((did) => occupied.has(channelKey({ localDid: did, peerDid: from.peerDid }))).length;
    }
    const [a, b] = [row.get(from.peerDid)!, row.get(to.peerDid)!].sort((m, n) => m - n);
    return view.peers.slice(a! + 1, b).filter((did) => occupied.has(channelKey({ localDid: from.localDid, peerDid: did }))).length;
  };

  const edge = (from: Channel, to: Channel, kind: (typeof ARROWS)[number], classes: string, text: string) => {
    const horizontal = from.peerDid === to.peerDid;
    const forward = horizontal ? x(to) > x(from) : y(to) > y(from);
    const skipped = between(from, to);
    const bend = !forward ? 34 + 10 * skipped : skipped > 0 ? -(30 + 10 * skipped) : 0;
    const sign = forward ? 1 : -1;
    const [x1, y1, x2, y2] = horizontal
      ? [x(from) + (sign * NODE_W) / 2, y(from), x(to) - (sign * NODE_W) / 2, y(to)]
      : [x(from), y(from) + (sign * NODE_H) / 2, x(to), y(to) - (sign * NODE_H) / 2];
    const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
    const [cx, cy] = horizontal ? [mx, my + bend * 1.6] : [mx + bend * 1.6, my];
    const d = bend === 0 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;
    edges.append(el("path", { d, class: `edge ${classes}`, "marker-end": `url(#arrow-${kind})` }));
    const [lx, ly] = bend === 0 ? [mx, my] : [(x1 + 2 * cx + x2) / 4, (y1 + 2 * cy + y2) / 4];
    labels.append(
      horizontal
        ? el("text", { x: lx, y: ly - 7, class: `edge-label ${classes}`, "text-anchor": "middle" }, text)
        : el("text", { x: lx + 8, y: ly + 4, class: `edge-label ${classes}`, "text-anchor": "start" }, text),
    );
  };

  const claimOf = (link: PositiveLink) =>
    link.support.find((fact) =>
      link.replaces === "peer"
        ? fact.kind === "peer-observation" && fact.rotatedFrom === link.from.peerDid && channelKey(fact.at) === channelKey(link.to)
        : fact.kind === "local-decision" && fact.change.kind === "rotate" && fact.change.successor === link.to.localDid && channelKey(fact.at) === channelKey(link.from),
    );

  for (const link of view.links) {
    const key = `${channelKey(link.from)}\u0001${channelKey(link.to)}`;
    const kind = link.usable ? link.replaces : "diagnostic";
    const claim = link.derived ? undefined : claimOf(link);
    const text = link.derived ? "join" : claim ? label(claim) : "";
    const classes = [link.replaces, link.usable ? "usable" : "diagnostic", link.derived ? "derived" : "base", onPath.has(key) ? "on-path" : ""].join(" ");
    edge(link.from, link.to, kind, classes, text);
  }
  for (const claim of view.claims as Claim[]) {
    const kind = claim.status.status === "conflict" ? "conflict" : "waiting";
    edge(claim.from, claim.to, kind, `claim ${kind}`, label(claim.fact));
  }
  svg.append(edges, labels);

  const at = new Map<string, ContinuityFact[]>();
  for (const fact of view.model.facts) {
    const key = channelKey(fact.at);
    at.set(key, [...(at.get(key) ?? []), fact]);
  }
  const touched = new Set([...at.keys(), ...view.links.flatMap((link) => [channelKey(link.from), channelKey(link.to)])]);

  const nodes = el("g", { class: "nodes" });
  for (const channel of view.channels) {
    const key = channelKey(channel);
    const here = at.get(key) ?? [];
    const classes = [
      "node",
      view.conflictScope.has(key) ? "conflict" : "",
      touched.has(key) ? "" : "ghost",
      marks.selected && channelKey(marks.selected) === key ? "selected" : "",
      marks.head && channelKey(marks.head) === key ? "head" : "",
      marks.path.some((step) => channelKey(step) === key) ? "on-path" : "",
      marks.highlight.has(key) ? "highlight" : "",
    ].join(" ");
    const notes = here.map((fact) => (fact.kind === "peer-observation" ? label(fact) : fact.kind === "peer-ending" || fact.change.kind === "end" ? `end ${label(fact)}` : "")).filter(Boolean);
    const group = el("g", { class: classes, tabindex: 0, role: "button", "aria-label": `Query ${pairText(channel)}`, "data-key": domKey(channel), transform: `translate(${x(channel)} ${y(channel)})` });
    group.append(
      el("rect", { x: -NODE_W / 2, y: -NODE_H / 2, width: NODE_W, height: NODE_H, rx: 10 }),
      el("text", { y: notes.length > 0 ? -3 : 5, class: "pair", "text-anchor": "middle" }, pairText(channel)),
    );
    if (notes.length > 0) group.append(el("text", { y: 15, class: "notes", "text-anchor": "middle" }, notes.join(" ")));
    if (marks.head && channelKey(marks.head) === key) group.append(el("text", { x: NODE_W / 2 - 4, y: NODE_H / 2 + 14, class: "tag", "text-anchor": "end" }, "head"));
    group.addEventListener("click", () => onSelect(channel));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(channel);
      }
    });
    nodes.append(group);
  }
  svg.append(nodes);
  return svg;
}
