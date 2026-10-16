import { binds, derive, factKey, isRotation, pairKey, pairText, type Authority, type Channel, type Did, type Documents, type Fact, type Model, type Status } from "./model.ts";
import { domKey, drawEras } from "./render.ts";
import { ended, observe, rotated, type LabelledFact, type Scenario } from "./scenarios.ts";

type State = {
  items: LabelledFact[];
  documents: Documents;
  selected: Channel;
  skipEraCheck: boolean;
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  for (const child of children) if (child !== null) node.append(child);
  return node;
}

type Tone = "observation" | "key" | "recovery" | "ending";

const toneOf = (fact: Fact): Tone => (fact.kind === "peer-ending" ? "ending" : fact.rotatedFrom === null ? "observation" : fact.rotatedFrom.authority);

const PREFIX: Record<Tone, string> = { observation: "o", key: "f", recovery: "r", ending: "e" };

export function describe(fact: Fact): string {
  const { localDid, peerDid } = fact.at;
  if (fact.kind === "peer-ending") {
    return fact.authority === "key" ? `${peerDid} ended, signed with its key, in a proof sent to ${localDid}` : `${peerDid}'s recovery key ended it, in a proof sent to ${localDid}`;
  }
  if (fact.rotatedFrom === null) return `${peerDid} wrote to ${localDid}`;
  const { did, authority } = fact.rotatedFrom;
  return authority === "key"
    ? `${peerDid} wrote to ${localDid}, carrying ${did} → ${peerDid} signed with ${did}'s key`
    : `${peerDid} wrote to ${localDid}, carrying ${did} ⇒ ${peerDid} signed with ${did}'s recovery key`;
}

function freshLabel(items: readonly LabelledFact[], fact: Fact): string {
  const prefix = PREFIX[toneOf(fact)];
  const taken = new Set(items.map((item) => item.label));
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function freshDid(items: readonly LabelledFact[], documents: Documents): Did {
  const used = new Set([...Object.keys(documents), ...items.flatMap(({ fact }) => [fact.at.localDid, fact.at.peerDid, ...(isRotation(fact) ? [fact.rotatedFrom.did] : [])])]);
  for (const letter of "ABCDEFGHIJKNOPQRSTUVWXYZ") if (!used.has(letter)) return letter;
  let n = 1;
  while (used.has(`Z${n}`)) n++;
  return `Z${n}`;
}

const freshEra = () => [...crypto.getRandomValues(new Uint8Array(2))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function parseFact(value: unknown): Fact {
  const record = value as { kind?: unknown; at?: { localDid?: unknown; peerDid?: unknown }; rotatedFrom?: { did?: unknown; authority?: unknown } | null; authority?: unknown };
  const did = (text: unknown) => {
    if (typeof text !== "string" || text === "") throw new Error("not a DID");
    return text;
  };
  const authority = (text: unknown): Authority => {
    if (text !== "key" && text !== "recovery") throw new Error("not an authority");
    return text;
  };
  const at = { localDid: did(record.at?.localDid), peerDid: did(record.at?.peerDid) };
  if (record.kind === "peer-ending") return { kind: "peer-ending", at, authority: authority(record.authority) };
  if (record.kind !== "peer-observation") throw new Error("not a fact");
  return { kind: "peer-observation", at, rotatedFrom: record.rotatedFrom ? { did: did(record.rotatedFrom.did), authority: authority(record.rotatedFrom.authority) } : null };
}

type Saved = { items: LabelledFact[]; documents: Documents; skipEraCheck: boolean };

function encode(saved: Saved): string {
  const bytes = new TextEncoder().encode(JSON.stringify(saved));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(text: string): Saved {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))) as { items?: unknown; documents?: unknown; skipEraCheck?: unknown };
  if (!Array.isArray(parsed.items)) throw new Error("not a saved lab");
  const documents: Record<Did, string> = {};
  for (const [did, era] of Object.entries((parsed.documents ?? {}) as Record<string, unknown>)) if (typeof era === "string") documents[did] = era;
  return {
    items: parsed.items.map((item: { label?: unknown; fact?: unknown; on?: unknown }, index) => ({
      label: typeof item.label === "string" ? item.label : `x${index + 1}`,
      fact: parseFact(item.fact),
      on: item.on !== false,
    })),
    documents,
    skipEraCheck: parsed.skipEraCheck === true,
  };
}

export type LabOptions = {
  scenario: Scenario;
  presets?: Record<string, Scenario>;
};

export function mountLab(root: HTMLElement, { scenario, presets }: LabOptions) {
  const sandbox = presets !== undefined;
  const fromHash = sandbox ? readHash() : null;
  const state: State = fromHash
    ? { ...fromHash, selected: fromHash.items[0]?.fact.at ?? scenario.focus }
    : { items: scenario.facts.map((item) => ({ ...item })), documents: { ...scenario.documents }, selected: scenario.focus, skipEraCheck: false };
  let showsEraCheck = sandbox || scenario.eraCheck === true;

  function readHash(): Saved | null {
    const match = /^#sandbox=(.+)$/.exec(location.hash);
    if (!match) return null;
    try {
      return decode(match[1]!);
    } catch {
      return null;
    }
  }

  const update = (change: Partial<State>) => {
    Object.assign(state, change);
    if (sandbox && ("items" in change || "documents" in change || "skipEraCheck" in change)) {
      history.replaceState(null, "", `#sandbox=${encode({ items: state.items, documents: state.documents, skipEraCheck: state.skipEraCheck })}`);
    }
    render();
  };

  const labelOf = (fact: Fact) => state.items.find((item) => factKey(item.fact) === factKey(fact))?.label ?? "?";

  const hover = (target: Element, fact: Fact) => {
    const keys = new Set([domKey(fact.at), ...(isRotation(fact) ? [domKey({ localDid: fact.at.localDid, peerDid: fact.rotatedFrom.did })] : [])]);
    const mark = (on: boolean) => {
      for (const node of root.querySelectorAll(".node")) node.classList.toggle("hover", on && keys.has(node.getAttribute("data-key") ?? ""));
    };
    target.addEventListener("mouseenter", () => mark(true));
    target.addEventListener("mouseleave", () => mark(false));
  };

  const chip = (fact: Fact) => {
    const node = h("span", { class: `chip tone-${toneOf(fact)}`, title: describe(fact) }, labelOf(fact));
    hover(node, fact);
    return node;
  };
  const chips = (facts: readonly Fact[]) => (facts.length === 0 ? h("span", { class: "none" }, "none") : h("span", { class: "chips" }, ...facts.map(chip)));

  const admitted = (fact: Fact) => state.skipEraCheck || binds(fact, state.documents);

  function rejection(fact: Fact): string {
    if (!isRotation(fact)) return "";
    const from = fact.rotatedFrom.did;
    const to = fact.at.peerDid;
    return fact.rotatedFrom.authority === "key"
      ? `${from}'s document carries era ${state.documents[from] ?? "?"} and ${to}'s ${state.documents[to] ?? "?"}; a first-order rotation keeps the era`
      : `${from} and ${to} both carry era ${state.documents[to] ?? "?"}; a recovery opens a new one`;
  }

  const badge = (item: LabelledFact, status: Status | null) => {
    if (!item.on) return h("span", { class: "badge off" }, "off");
    if (status === null) return h("span", { class: "badge rejected", title: rejection(item.fact) }, "rejected at binding");
    switch (status.status) {
      case "superseded":
        return h("span", { class: "badge superseded", title: `by ${status.by.map(labelOf).join(", ")}` }, "superseded");
      case "not-counted":
        return h("span", { class: "badge superseded", title: `on a pair ${status.by.map(labelOf).join(", ")} superseded` }, "not counted");
      case "conflict":
        return h("span", { class: "badge conflict", title: `with ${status.facts.map(labelOf).join(", ")}` }, "conflict");
      default:
        return h("span", { class: `badge ${status.status}` }, status.status);
    }
  };

  function addFact(fact: Fact, documents: Documents = state.documents) {
    if (state.items.some((item) => factKey(item.fact) === factKey(fact))) return;
    update({ items: [...state.items, { label: freshLabel(state.items, fact), fact, on: true }], documents });
  }

  function factsPanel(model: Model) {
    const list = h("ul", { class: "facts" });
    state.items.forEach((item, index) => {
      const toggle = h("input", { type: "checkbox", "aria-label": `Include ${item.label}` });
      toggle.checked = item.on;
      toggle.addEventListener("change", () => update({ items: state.items.map((other, i) => (i === index ? { ...other, on: toggle.checked } : other)) }));
      const row = h(
        "li",
        { class: item.on ? "fact" : "fact off" },
        h("label", {}, toggle, h("span", { class: `chip tone-${toneOf(item.fact)}` }, item.label), h("span", { class: "desc" }, describe(item.fact))),
        badge(item, item.on && admitted(item.fact) ? model.status(item.fact) : null),
      );
      if (sandbox) {
        const remove = h("button", { class: "remove", type: "button", "aria-label": `Remove ${item.label}` }, "×");
        remove.addEventListener("click", () => update({ items: state.items.filter((_, i) => i !== index) }));
        row.append(remove);
      }
      hover(row, item.fact);
      list.append(row);
    });
    const panel = h("div", { class: "panel facts-panel" }, h("h4", {}, "Facts"), list);
    if (showsEraCheck) {
      const check = h("input", { type: "checkbox" });
      check.checked = !state.skipEraCheck;
      check.addEventListener("change", () => update({ skipEraCheck: !check.checked }));
      panel.append(h("label", { class: "era-check" }, check, h("span", {}, "Binding compares ", h("code", {}, "era"))));
    }
    if (sandbox) panel.append(actions());
    return panel;
  }

  function actions() {
    const { localDid, peerDid } = state.selected;
    const button = (text: string, make: () => void) => {
      const node = h("button", { type: "button" }, text);
      node.addEventListener("click", make);
      return node;
    };
    const rotate = (authority: Authority) => () => {
      const successor = freshDid(state.items, state.documents);
      const era = authority === "key" ? state.documents[peerDid] ?? freshEra() : freshEra();
      addFact(rotated(localDid, successor, peerDid, authority), { ...state.documents, [peerDid]: state.documents[peerDid] ?? era, [successor]: era });
    };
    const presetPicker = h("select", { "aria-label": "Load a scenario" }, h("option", { value: "" }, "Load a scenario…"), ...Object.entries(presets!).map(([key, preset]) => h("option", { value: key }, preset.title)));
    presetPicker.addEventListener("change", () => {
      const preset = presets![presetPicker.value];
      if (preset) update({ items: preset.facts.map((item) => ({ ...item })), documents: { ...preset.documents }, selected: preset.focus, skipEraCheck: false });
    });
    const clear = button("Clear", () => update({ items: [] }));
    return h(
      "div",
      { class: "actions" },
      h("p", { class: "hint" }, `Add at ${pairText(state.selected)}:`),
      h(
        "div",
        { class: "buttons" },
        button(`${peerDid} writes to ${localDid}`, () => addFact(observe(localDid, peerDid))),
        button(`${peerDid} rotates with its key`, rotate("key")),
        button(`${peerDid} is recovered`, rotate("recovery")),
        button(`${peerDid} ends with its key`, () => addFact(ended(localDid, peerDid, "key"))),
        button(`Recovery ends ${peerDid}`, () => addFact(ended(localDid, peerDid, "recovery"))),
      ),
      h("div", { class: "buttons" }, presetPicker, clear),
    );
  }

  function answerPanel(model: Model) {
    const channel = state.selected;
    const era = model.eraOf(channel);
    const eraText = era
      ? h(
          "span",
          {},
          h("strong", {}, `{${era.members.join(", ")}}`),
          `, document era ${[...new Set(era.members.map((did) => state.documents[did] ?? "?"))].join(" ≠ ")}`,
          era.recoveredBy.length > 0 ? h("span", { class: "question" }, "Recovered by ", chips(era.recoveredBy), `, so ${pairText(channel)} is superseded.`) : null,
        )
      : h("span", { class: "none" }, "outside any relationship: no claim relates this pair");

    const head = model.head(channel);
    const headText = (() => {
      switch (head.status) {
        case "head":
          return pairKey(head.channel) === pairKey(channel)
            ? h("span", {}, "this pair itself: nothing usable leads away")
            : h("span", {}, h("strong", {}, `→ ${pairText(head.channel)}`), " via ", chips(head.via));
        case "ended":
          return h("span", {}, h("strong", {}, "ended"), " by ", chips(head.endings));
        case "conflict":
          return h("span", {}, h("strong", { class: "alarm" }, "conflict"), " involving ", chips(head.facts));
        case "no-evidence":
          return h("span", {}, "no fact mentions this pair");
      }
    })();

    const confirmation = model.confirmation(channel.localDid, channel.peerDid);
    const ignored = (facts: readonly Fact[]) => (facts.length > 0 ? h("span", { class: "question" }, "Not counted, on a superseded pair: ", chips(facts)) : null);
    const confirmationText = (() => {
      switch (confirmation.status) {
        case "confirmed":
          return h("span", {}, h("strong", {}, "yes"), ", by ", chips(confirmation.witnesses), ignored(confirmation.notCounted));
        case "unconfirmed":
          return h("span", {}, h("strong", {}, "not yet"), ignored(confirmation.notCounted));
        case "conflict":
          return h("span", {}, h("strong", { class: "alarm" }, "conflict"), " involving ", chips(confirmation.facts));
      }
    })();

    return h(
      "div",
      { class: "panel answer", "aria-live": "polite" },
      h("h4", {}, `Query ${pairText(channel)}`),
      h(
        "dl",
        {},
        h("dt", {}, `era of ${channel.peerDid}`),
        h("dd", {}, eraText),
        h("dt", {}, h("code", {}, "head")),
        h("dd", {}, headText),
        h("dt", {}, h("code", {}, "confirmation")),
        h("dd", {}, h("span", { class: "question" }, `Has ${channel.peerDid}, or a usable successor, written to exactly ${channel.localDid}? `), confirmationText),
      ),
    );
  }

  function render() {
    const active = (document.activeElement as Element | null)?.closest?.("[data-key]")?.getAttribute("data-key");
    const model = derive(state.items.filter((item) => item.on && admitted(item.fact)).map((item) => item.fact));
    showsEraCheck ||= state.items.some((item) => !binds(item.fact, state.documents));
    const head = model.head(state.selected);
    const svg = drawEras({
      model,
      documents: state.documents,
      label: labelOf,
      marks: {
        selected: state.selected,
        head: head.status === "head" && pairKey(head.channel) !== pairKey(state.selected) ? head.channel : null,
        path: head.status === "head" || head.status === "ended" ? head.path : [],
      },
      onSelect: (channel) => update({ selected: channel }),
    });
    root.replaceChildren(h("div", { class: "graph" }, svg), h("div", { class: "lab-panels" }, factsPanel(model), answerPanel(model)));
    if (active) root.querySelector<SVGGElement>(`[data-key="${CSS.escape(active)}"]`)?.focus();
  }

  render();
}
