import "../shared/style.css";
import "../shared/lab.css";
import "./era.css";
import { mountLab } from "./lab.ts";
import { labs, presets, type LabName } from "./scenarios.ts";

for (const root of document.querySelectorAll<HTMLElement>("[data-lab]")) {
  const name = root.dataset.lab!;
  if (name === "sandbox") mountLab(root, { scenario: presets.eras!, presets });
  else if (name in labs) mountLab(root, { scenario: labs[name as LabName] });
}
