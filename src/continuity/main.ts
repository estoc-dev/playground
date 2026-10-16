import "../shared/style.css";
import "../shared/lab.css";
import "./continuity.css";
import { PROFILE_VERSION } from "@estoc/continuity";
import { mountLab } from "./lab.ts";
import { labs, presets, type LabName } from "./scenarios.ts";

for (const root of document.querySelectorAll<HTMLElement>("[data-lab]")) {
  const name = root.dataset.lab!;
  if (name === "sandbox") mountLab(root, { scenario: presets.join!, presets });
  else if (name in labs) mountLab(root, { scenario: labs[name as LabName] });
}

for (const node of document.querySelectorAll("[data-profile]")) node.textContent = PROFILE_VERSION;
