import { isRotation, pairKey, pairText, predecessorOf, type Channel, type Did, type Documents, type Era, type Fact, type Model, type Relationship } from "./model.ts";

const NS = "http://www.w3.org/2000/svg";

/** A pair key an attribute value and a selector can hold. */
export const domKey = (channel: Channel) => `${encodeURIComponent(channel.localDid)} ${encodeURIComponent(channel.peerDid)}`;
const NODE_W = 96;
const NODE_H = 44;
const ROW = 76;
const PAD_X = 18;
const PAD_TOP = 30;
const PAD_BOTTOM = 14;
const RECOVERED_NOTE = 18;
const LANE_GAP = 22;
const COLUMN_GAP = 92;
const BOX_GAP = 22;
const BLOCK_GAP = 36;
const HEADING = 26;
const MARGIN = 14;

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
};

export type Draw = {
  model: Model;
  documents: Documents;
  label: (fact: Fact) => string;
  marks: Marks;
  onSelect: (channel: Channel) => void;
};

/** A DID sits after the DIDs that rotate into it; ties and cycles break by name. */
function order(members: readonly Did[], edges: readonly [Did, Did][]): Did[] {
  const pending = new Set(members);
  const result: Did[] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter((did) => !edges.some(([from, to]) => to === did && from !== did && pending.has(from))).sort();
    const next = ready[0] ?? [...pending].sort()[0]!;
    pending.delete(next);
    result.push(next);
  }
  return result;
}

type Box = { era: Era; x: number; y: number; width: number; height: number };
type Spot = { x: number; y: number; box: Box | null; rank: number };

/** Each DID one rank below the latest DID that rotates into it, so branches sit side by side. */
function ranks(members: readonly Did[], edges: readonly [Did, Did][]): Did[][] {
  const topo = order(members, edges);
  const position = new Map(topo.map((did, index) => [did, index]));
  const rank = new Map<Did, number>();
  for (const did of topo) {
    const earlier = edges.filter(([from, to]) => to === did && position.has(from) && position.get(from)! < position.get(did)!);
    rank.set(did, Math.max(0, ...earlier.map(([from]) => rank.get(from)! + 1)));
  }
  const rows: Did[][] = [];
  for (const did of topo) (rows[rank.get(did)!] ??= []).push(did);
  return rows.filter((row) => row !== undefined);
}

function layoutRelationship(relationship: Relationship, top: number) {
  const eraOfDid = new Map<Did, Era>();
  for (const era of relationship.eras) for (const did of era.members) eraOfDid.set(did, era);
  const recoveries = relationship.claims.filter((claim) => isRotation(claim) && claim.rotatedFrom.authority === "recovery");
  const firstOrder = relationship.claims.filter(isRotation).filter((claim) => claim.rotatedFrom.authority === "key").map((claim): [Did, Did] => [claim.rotatedFrom.did, claim.at.peerDid]);

  const depth = new Map(relationship.eras.map((era) => [era.id, 0]));
  for (let round = 0; round < relationship.eras.length; round++) {
    for (const claim of recoveries) {
      const from = eraOfDid.get(predecessorOf(claim).peerDid)!.id;
      const to = eraOfDid.get(claim.at.peerDid)!.id;
      if (from !== to) depth.set(to, Math.min(relationship.eras.length, Math.max(depth.get(to)!, depth.get(from)! + 1)));
    }
  }

  const spots = new Map<string, Spot>();
  const boxes: Box[] = [];
  const columns = [...new Set(depth.values())].sort((a, b) => a - b);
  let bottom = top;
  let x = MARGIN;
  for (const column of columns) {
    const eras = relationship.eras.filter((era) => depth.get(era.id) === column);
    const desired = (era: Era) => {
      const sources = recoveries.filter((claim) => eraOfDid.get(claim.at.peerDid) === era).map((claim) => spots.get(pairKey(predecessorOf(claim)))?.y);
      const known = sources.filter((y): y is number => y !== undefined);
      return known.length > 0 ? Math.min(...known) - PAD_TOP - NODE_H / 2 : top;
    };
    let cursor = top;
    let columnWidth = 0;
    for (const era of [...eras].sort((a, b) => desired(a) - desired(b) || (a.members[0]! < b.members[0]! ? -1 : 1))) {
      const rows = ranks(era.members, firstOrder);
      const lanes = Math.max(...rows.map((row) => row.length));
      const y = Math.max(cursor, desired(era));
      const width = 2 * PAD_X + lanes * NODE_W + (lanes - 1) * LANE_GAP;
      const height = PAD_TOP + (rows.length - 1) * ROW + NODE_H + PAD_BOTTOM + (era.recoveredBy.length > 0 ? RECOVERED_NOTE : 0);
      const box: Box = { era, x, y, width, height };
      boxes.push(box);
      rows.forEach((row, rank) =>
        row.forEach((did, lane) =>
          spots.set(pairKey({ localDid: relationship.localDid, peerDid: did }), { x: x + PAD_X + lane * (NODE_W + LANE_GAP) + NODE_W / 2, y: y + PAD_TOP + rank * ROW + NODE_H / 2, box, rank }),
        ),
      );
      cursor = y + height + BOX_GAP;
      bottom = Math.max(bottom, y + height);
      columnWidth = Math.max(columnWidth, width);
    }
    x += columnWidth + COLUMN_GAP;
  }
  return { spots, boxes, bottom, width: x - COLUMN_GAP + MARGIN };
}

const ARROWS = ["key", "recovery", "derived", "superseded", "conflict"] as const;

export function drawEras({ model, documents, label, marks, onSelect }: Draw): SVGSVGElement {
  const spots = new Map<string, Spot>();
  const boxes: Box[] = [];
  const headings: { text: string; y: number }[] = [];
  let y = MARGIN;
  let width = 2 * MARGIN + NODE_W;
  for (const relationship of model.relationships) {
    headings.push({ text: `Relationship at ${relationship.localDid}`, y: y + 12 });
    const layout = layoutRelationship(relationship, y + HEADING);
    for (const [key, spot] of layout.spots) spots.set(key, spot);
    boxes.push(...layout.boxes);
    width = Math.max(width, layout.width);
    y = layout.bottom + BLOCK_GAP;
  }
  if (model.sites.length > 0) {
    headings.push({ text: "Outside any relationship", y: y + 12 });
    model.sites.forEach((channel, index) => spots.set(pairKey(channel), { x: MARGIN + PAD_X + NODE_W / 2 + index * (NODE_W + 24), y: y + HEADING + NODE_H / 2, box: null, rank: 0 }));
    width = Math.max(width, MARGIN * 2 + PAD_X + model.sites.length * (NODE_W + 24));
    y += HEADING + NODE_H + BLOCK_GAP;
  }
  const height = y - BLOCK_GAP + MARGIN;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: "eras", role: "group" });
  svg.style.setProperty("--natural-width", `${width}px`);
  svg.append(
    el(
      "defs",
      {},
      ...ARROWS.map((kind) =>
        el("marker", { id: `era-arrow-${kind}`, class: `arrow arrow-${kind}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" }, el("path", { d: "M0 0 L10 5 L0 10 z" })),
      ),
    ),
  );

  const frame = el("g", { class: "frame", "aria-hidden": "true" });
  for (const heading of headings) frame.append(el("text", { x: MARGIN, y: heading.y, class: "heading" }, heading.text));
  for (const box of boxes) {
    const values = [...new Set(box.era.members.map((did) => documents[did] ?? "?"))];
    const mixed = values.length > 1;
    frame.append(
      el("rect", { x: box.x, y: box.y, width: box.width, height: box.height, rx: 12, class: `era-box${box.era.recoveredBy.length > 0 ? " recovered" : ""}${mixed ? " mixed" : ""}` }),
      el("text", { x: box.x + 10, y: box.y + 18, class: `era-label${mixed ? " mixed" : ""}` }, `era ${values.join(" ≠ ")}`),
    );
    if (box.era.recoveredBy.length > 0) {
      frame.append(el("text", { x: box.x + 10, y: box.y + box.height - 10, class: "era-note" }, `recovered by ${box.era.recoveredBy.map(label).join(", ")}`));
    }
  }
  svg.append(frame);

  const onPath = new Set<string>();
  for (let i = 1; i < marks.path.length; i++) onPath.add(`${pairKey(marks.path[i - 1]!)}\u0001${pairKey(marks.path[i]!)}`);

  type Drawn = { from: Channel; to: Channel; kind: (typeof ARROWS)[number]; classes: string; text: string; double: boolean };
  const drawn: Drawn[] = [];
  for (const claim of model.facts.filter(isRotation)) {
    const status = model.status(claim).status;
    const recovery = claim.rotatedFrom.authority === "recovery";
    const kind = status === "conflict" ? "conflict" : status === "superseded" ? "superseded" : recovery ? "recovery" : "key";
    drawn.push({ from: predecessorOf(claim), to: claim.at, kind, classes: `${recovery ? "recovery" : "key"} ${status}`, text: label(claim), double: recovery });
  }
  for (const link of model.links) {
    if (!link.derived) continue;
    drawn.push({ from: link.from, to: link.to, kind: link.usable ? "derived" : "superseded", classes: `derived ${link.usable ? "usable" : "blocked"}`, text: "", double: false });
  }

  const incoming = new Map<string, Drawn[]>();
  for (const edge of drawn) {
    const from = spots.get(pairKey(edge.from));
    const to = spots.get(pairKey(edge.to));
    if (!from || !to || from.box === to.box) continue;
    incoming.set(pairKey(edge.to), [...(incoming.get(pairKey(edge.to)) ?? []), edge]);
  }
  for (const group of incoming.values()) group.sort((a, b) => spots.get(pairKey(a.from))!.y - spots.get(pairKey(b.from))!.y);
  const spread = (edge: Drawn) => {
    const group = incoming.get(pairKey(edge.to)) ?? [edge];
    const step = Math.min(9, (NODE_H - 12) / Math.max(1, group.length - 1));
    return (group.indexOf(edge) - (group.length - 1) / 2) * step;
  };

  const edges = el("g", { class: "edges" });
  const labels = el("g", { class: "edge-labels" });
  for (const edge of drawn) {
    const from = spots.get(pairKey(edge.from));
    const to = spots.get(pairKey(edge.to));
    if (!from || !to) continue;
    let d: string;
    let at: [number, number, "start" | "middle" | "end"];
    if (from.box !== null && from.box === to.box) {
      const span = to.rank - from.rank;
      if (span === 1) {
        d = `M${from.x} ${from.y + NODE_H / 2} L${to.x} ${to.y - NODE_H / 2}`;
        at = [(from.x + to.x) / 2 + 8, (from.y + to.y) / 2 + 4, "start"];
      } else {
        const side = span > 0 ? 1 : -1;
        const [x1, x2] = [from.x + (side * NODE_W) / 2, to.x + (side * NODE_W) / 2];
        const bulge = (side > 0 ? Math.max(x1, x2) : Math.min(x1, x2)) + side * (16 + 6 * Math.abs(span));
        d = `M${x1} ${from.y} Q${bulge} ${(from.y + to.y) / 2} ${x2} ${to.y}`;
        at = [(x1 + x2) / 4 + bulge / 2 + side * 4, (from.y + to.y) / 2 + 4, side > 0 ? "start" : "end"];
      }
    } else if (to.x > from.x) {
      const right = Math.max(...[...spots.values()].filter((other) => other.box === from.box && other.rank === from.rank).map((other) => other.x));
      const [x1, y1, x2, y2] = [right + NODE_W / 2 + (right > from.x ? 12 : 0), right > from.x ? from.y + 10 : from.y, to.x - NODE_W / 2, to.y + spread(edge)];
      const dx = (x2 - x1) / 2;
      const curve = `C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
      const under = from.y + NODE_H / 2 + 9;
      d = right > from.x ? `M${from.x} ${from.y + NODE_H / 2} Q${from.x} ${under} ${from.x + 12} ${under} L${x1 - 12} ${under} Q${x1} ${under} ${x1} ${y1} ${curve}` : `M${x1} ${y1} ${curve}`;
      const level = Math.abs(y2 - y1) < 12;
      const t = level ? 0.3 : 0.5;
      const point = (a: number, b: number, c: number, e: number) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * e;
      const [lx, ly] = [point(x1, x1 + dx, x2 - dx, x2), point(y1, y1, y2, y2)];
      at = level ? [lx, ly - 8, "middle"] : [lx + 8, ly + 4, "start"];
    } else {
      const [x1, y1, x2, y2] = [from.x - NODE_W / 2, from.y, to.x - NODE_W / 2, to.y];
      const bulge = Math.min(x1, x2) - 34;
      d = `M${x1} ${y1} C${bulge} ${y1} ${bulge} ${y2} ${x2} ${y2}`;
      at = [bulge + 6, (y1 + y2) / 2, "middle"];
    }
    const path = onPath.has(`${pairKey(edge.from)}\u0001${pairKey(edge.to)}`) ? " on-path" : "";
    edges.append(el("path", { d, class: `edge ${edge.classes}${path}`, "marker-end": `url(#era-arrow-${edge.kind})` }));
    if (edge.double) edges.append(el("path", { d, class: "edge gap" }));
    if (edge.text) labels.append(el("text", { x: at[0], y: at[1], class: `edge-label ${edge.classes}`, "text-anchor": at[2] }, edge.text));
  }
  svg.append(edges, labels);

  const notesAt = new Map<string, string[]>();
  for (const fact of model.facts) {
    if (isRotation(fact)) continue;
    const text = fact.kind === "peer-ending" ? `end ${label(fact)}` : label(fact);
    notesAt.set(pairKey(fact.at), [...(notesAt.get(pairKey(fact.at)) ?? []), text]);
  }

  const nodes = el("g", { class: "nodes" });
  for (const [key, spot] of spots) {
    const [localDid, peerDid] = key.split("\u0000") as [Did, Did];
    const channel = { localDid, peerDid };
    const notes = notesAt.get(key) ?? [];
    const classes = [
      "node",
      model.supersededPair(channel).length > 0 ? "superseded" : "",
      model.isBlocked(channel) ? "conflict" : "",
      marks.selected && pairKey(marks.selected) === key ? "selected" : "",
      marks.head && pairKey(marks.head) === key ? "head" : "",
      marks.path.some((step) => pairKey(step) === key) ? "on-path" : "",
    ].join(" ");
    const group = el("g", { class: classes, tabindex: 0, role: "button", "aria-label": `Query ${pairText(channel)}`, "data-key": domKey(channel), transform: `translate(${spot.x} ${spot.y})` });
    group.append(
      el("rect", { x: -NODE_W / 2, y: -NODE_H / 2, width: NODE_W, height: NODE_H, rx: 10 }),
      el("text", { y: notes.length > 0 ? -3 : 5, class: "pair", "text-anchor": "middle" }, pairText(channel)),
    );
    if (notes.length > 0) group.append(el("text", { y: 14, class: "notes", "text-anchor": "middle" }, notes.join(" ")));
    if (marks.head && pairKey(marks.head) === key) group.append(el("text", { x: NODE_W / 2 - 4, y: -NODE_H / 2 - 5, class: "tag", "text-anchor": "end" }, "head"));
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
