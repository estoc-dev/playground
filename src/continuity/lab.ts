import { factIdentity, validateFact, type Channel, type ContinuityFact, type Did, type FactStatus } from "@estoc/continuity";
import { channelKey, decide, describe, domKey, localEnd, observe, pairsOf, pairText, peerEnd, rotated, toneOf, type Tone } from "./facts.ts";
import { drawLattice } from "./render.ts";
import type { LabelledFact, Scenario } from "./scenarios.ts";
import { buildView, type View } from "./view.ts";

type Context = "samePeer" | "sameLocal";

type State = {
  items: LabelledFact[];
  selected: Channel;
  context: Context | null;
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  for (const child of children) if (child !== null) node.append(child);
  return node;
}

const PREFIX: Record<Tone, string> = { observation: "o", peer: "p", local: "d", ending: "e" };

function freshLabel(items: readonly LabelledFact[], fact: ContinuityFact): string {
  const prefix = PREFIX[toneOf(fact)];
  const taken = new Set(items.map((item) => item.label));
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function freshDid(items: readonly LabelledFact[], prefix: "A" | "B"): Did {
  const used = items.flatMap((item) => pairsOf(item.fact).flatMap((pair) => [pair.localDid, pair.peerDid]));
  const numbers = used.filter((did) => did.startsWith(prefix)).map((did) => Number(did.slice(1))).filter(Number.isInteger);
  return `${prefix}${Math.max(-1, ...numbers) + 1}`;
}

function encode(items: readonly LabelledFact[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(items));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(text: string): LabelledFact[] {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
  if (!Array.isArray(parsed)) throw new Error("not a list of facts");
  return parsed.map((item: { label?: unknown; fact?: unknown; on?: unknown }, index) => ({
    label: typeof item.label === "string" ? item.label : `f${index + 1}`,
    fact: validateFact(item.fact),
    on: item.on !== false,
  }));
}

export type LabOptions = {
  scenario: Scenario;
  presets?: Record<string, Scenario>;
};

export function mountLab(root: HTMLElement, { scenario, presets }: LabOptions) {
  const sandbox = presets !== undefined;
  const fromHash = sandbox ? readHash() : null;
  const state: State = {
    items: fromHash ?? scenario.facts.map((item) => ({ ...item })),
    selected: fromHash?.[0]?.fact.at ?? scenario.focus,
    context: null,
  };

  function readHash(): LabelledFact[] | null {
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
    if (sandbox && ("items" in change)) history.replaceState(null, "", `#sandbox=${encode(state.items)}`);
    render();
  };

  const labelOf = (fact: ContinuityFact) => state.items.find((item) => factIdentity(item.fact) === factIdentity(fact))?.label ?? "?";

  const hover = (target: Element, fact: ContinuityFact) => {
    const keys = new Set(pairsOf(fact).map(domKey));
    const mark = (on: boolean) => {
      for (const node of root.querySelectorAll(".node")) node.classList.toggle("hover", on && keys.has(node.getAttribute("data-key") ?? ""));
    };
    target.addEventListener("mouseenter", () => mark(true));
    target.addEventListener("mouseleave", () => mark(false));
  };

  const chip = (fact: ContinuityFact) => {
    const node = h("span", { class: `chip tone-${toneOf(fact)}`, title: describe(fact) }, labelOf(fact));
    hover(node, fact);
    return node;
  };
  const chips = (facts: readonly ContinuityFact[]) => (facts.length === 0 ? h("span", { class: "none" }, "none") : h("span", { class: "chips" }, ...facts.map(chip)));

  const badge = (status: FactStatus | null) => {
    if (status === null) return h("span", { class: "badge off" }, "off");
    const because = status.status === "waiting" || status.status === "conflict" ? status.because : "";
    return h("span", { class: `badge ${status.status}`, title: because }, status.status);
  };

  function addFact(fact: ContinuityFact) {
    if (state.items.some((item) => factIdentity(item.fact) === factIdentity(fact))) return;
    update({ items: [...state.items, { label: freshLabel(state.items, fact), fact, on: true }] });
  }

  function factsPanel(view: View) {
    const list = h("ul", { class: "facts" });
    state.items.forEach((item, index) => {
      const toggle = h("input", { type: "checkbox", "aria-label": `Include ${item.label}` });
      toggle.checked = item.on;
      toggle.addEventListener("change", () => update({ items: state.items.map((other, i) => (i === index ? { ...other, on: toggle.checked } : other)) }));
      const row = h(
        "li",
        { class: item.on ? "fact" : "fact off" },
        h("label", {}, toggle, h("span", { class: `chip tone-${toneOf(item.fact)}` }, item.label), h("span", { class: "desc" }, describe(item.fact))),
        badge(item.on ? view.model.status(item.fact) : null),
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
    if (sandbox) panel.append(actions());
    return panel;
  }

  function actions() {
    const { localDid, peerDid } = state.selected;
    const button = (text: string, make: () => ContinuityFact) => {
      const node = h("button", { type: "button" }, text);
      node.addEventListener("click", () => addFact(make()));
      return node;
    };
    const presetPicker = h("select", { "aria-label": "Load a scenario" }, h("option", { value: "" }, "Load a scenario…"), ...Object.entries(presets!).map(([key, preset]) => h("option", { value: key }, preset.title)));
    presetPicker.addEventListener("change", () => {
      const preset = presets![presetPicker.value];
      if (preset) update({ items: preset.facts.map((item) => ({ ...item })), selected: preset.focus, context: null });
    });
    const clear = h("button", { type: "button" }, "Clear");
    clear.addEventListener("click", () => update({ items: [] }));
    return h(
      "div",
      { class: "actions" },
      h("p", { class: "hint" }, `Add at ${pairText(state.selected)}:`),
      h(
        "div",
        { class: "buttons" },
        button(`${peerDid} writes to ${localDid}`, () => observe(localDid, peerDid)),
        button(`${peerDid} rotates`, () => rotated(localDid, freshDid(state.items, "B"), peerDid)),
        button(`You rotate ${localDid}`, () => decide(localDid, peerDid, freshDid(state.items, "A"))),
        button(`${peerDid} ends`, () => peerEnd(localDid, peerDid)),
        button("You end", () => localEnd(localDid, peerDid)),
      ),
      h("div", { class: "buttons" }, presetPicker, clear),
      jsonEditor(),
    );
  }

  function jsonEditor() {
    const area = h("textarea", { rows: "8", spellcheck: "false", "aria-label": "Facts as JSON" });
    area.value = JSON.stringify(state.items.map((item) => item.fact), null, 1);
    const error = h("p", { class: "error", role: "alert" });
    const apply = h("button", { type: "button" }, "Apply");
    apply.addEventListener("click", () => {
      try {
        const parsed: unknown = JSON.parse(area.value);
        if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of facts.");
        const items: LabelledFact[] = [];
        parsed.forEach((value, index) => {
          const fact = validateFact(value, `fact ${index}`);
          if (items.some((item) => factIdentity(item.fact) === factIdentity(fact))) return;
          const known = state.items.find((item) => factIdentity(item.fact) === factIdentity(fact));
          items.push({ label: known?.label ?? freshLabel([...state.items, ...items], fact), fact, on: true });
        });
        update({ items });
      } catch (thrown) {
        error.textContent = thrown instanceof Error ? thrown.message : String(thrown);
      }
    });
    return h("details", { class: "json" }, h("summary", {}, "Facts as JSON"), area, h("div", { class: "buttons" }, apply), error);
  }

  function answerPanel(view: View) {
    const { model } = view;
    const channel = state.selected;
    const head = model.head(channel);
    const headText = (() => {
      switch (head.status) {
        case "head":
          return channelKey(head.channel) === channelKey(channel)
            ? h("span", {}, "this pair itself: nothing usable leads away")
            : h("span", {}, h("strong", {}, `→ ${pairText(head.channel)}`), " with support ", chips(head.support));
        case "ended":
          return h("span", {}, h("strong", {}, "ended"), " by ", chips(head.endings));
        case "unresolved":
          return h("span", {}, h("strong", {}, "unresolved"), ", waiting on ", chips(head.waiting), " for an observation that confirms the predecessor address");
        case "conflict":
          return h("span", {}, h("strong", { class: "alarm" }, "conflict"), " involving ", chips(head.facts));
        case "no-evidence":
          return h("span", {}, "no fact mentions this pair");
      }
    })();

    const confirmation = model.confirmation(channel.localDid, channel.peerDid);
    const confirmationText = (() => {
      switch (confirmation.status) {
        case "confirmed":
          return h(
            "span",
            { class: "witnesses" },
            h("strong", {}, "yes"),
            ...confirmation.observations.map((item) => h("span", { class: "witness" }, chip(item.fact), " witness ", chips(item.support))),
          );
        case "unconfirmed":
          return h("span", {}, h("strong", {}, "not yet"), confirmation.unusable.length > 0 ? h("span", {}, "; not usable: ", chips(confirmation.unusable)) : null);
        case "conflict":
          return h("span", {}, h("strong", { class: "alarm" }, "conflict"), " involving ", chips(confirmation.facts));
      }
    })();

    const history = model.history(channel);
    const contextButton = (context: Context, text: string) => {
      const members = history[context];
      const node = h("button", { type: "button", class: "context", "aria-pressed": String(state.context === context) }, `${text} (${members.length})`);
      node.addEventListener("click", () => update({ context: state.context === context ? null : context }));
      return node;
    };

    return h(
      "div",
      { class: "panel answer", "aria-live": "polite" },
      h("h4", {}, `Query ${pairText(channel)}`),
      h(
        "dl",
        {},
        h("dt", {}, h("code", {}, "head")),
        h("dd", {}, headText),
        h("dt", {}, h("code", {}, "confirmation")),
        h("dd", {}, h("span", { class: "question" }, `Has ${channel.peerDid}, or a usable successor, written to exactly ${channel.localDid}? `), confirmationText),
        h("dt", {}, "contexts"),
        h("dd", { class: "buttons" }, contextButton("samePeer", `same peer ${channel.peerDid}`), contextButton("sameLocal", `same local ${channel.localDid}`)),
      ),
    );
  }

  function render() {
    const active = (document.activeElement as Element | null)?.closest?.("[data-key]")?.getAttribute("data-key");
    const facts = state.items.filter((item) => item.on).map((item) => item.fact);
    const view = buildView(facts);
    const head = view.model.head(state.selected);
    const headChannel = head.status === "head" ? head.channel : null;
    const path = headChannel ? view.model.path(state.selected, headChannel) : null;
    const contextMembers = state.context ? view.model.history(state.selected)[state.context] : [];
    const svg = drawLattice({
      view: view.channels.some((channel) => channelKey(channel) === channelKey(state.selected)) ? view : { ...view, channels: [...view.channels, state.selected], locals: withDid(view.locals, state.selected.localDid), peers: withDid(view.peers, state.selected.peerDid) },
      label: labelOf,
      marks: {
        selected: state.selected,
        head: headChannel && channelKey(headChannel) !== channelKey(state.selected) ? headChannel : null,
        path: path?.status === "path" ? path.channels : [],
        highlight: new Set(contextMembers.map(channelKey)),
      },
      onSelect: (channel) => update({ selected: channel, context: null }),
    });
    root.replaceChildren(h("div", { class: "graph" }, svg), h("div", { class: "lab-panels" }, factsPanel(view), answerPanel(view)));
    if (active) root.querySelector<SVGGElement>(`[data-key="${CSS.escape(active)}"]`)?.focus();
  }

  render();
}

const withDid = (dids: readonly Did[], did: Did) => (dids.includes(did) ? [...dids] : [...dids, did]);
