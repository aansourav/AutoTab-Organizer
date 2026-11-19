import {
  GROUP_COLORS,
  chromeColorLabel,
  normalizeColor,
  parseColor,
  rgbFromHex,
} from "./color.js";
import { colorForDomain, titleFromHost } from "./matcher.js";
import { MessageType } from "./messages.js";
import { normalizePattern, parsePatternList } from "./patterns.js";
import {
  MAX_RULES,
  createRule,
  defaultState,
  normalizeState,
  parseBackup,
  serializeBackup,
} from "./rules.js";
import { loadState, saveState } from "./storage.js";

const rulesRoot = document.querySelector("#rules");
const status = document.querySelector("#status");
const autoOrganize = document.querySelector("#auto-organize");
const autoDomain = document.querySelector("#auto-domain");
const threshold = document.querySelector("#threshold");
const fileInput = document.querySelector("#import-file");

const freshState = () => normalizeState(defaultState(), { trustOrder: true });

const page = {
  state: freshState(),
  canSave: false,
  saveTimer: 0,
};

let saveTail = Promise.resolve();
let saveGeneration = 0;

const extensionAvailable = () =>
  Boolean(globalThis.chrome?.storage?.sync && globalThis.chrome?.runtime);

const setStatus = (message) => {
  status.textContent = message;
};

const findRule = (ruleId) =>
  page.state.rules.find((rule) => rule.id === ruleId);

const channelValue = (article, name) =>
  article.querySelector(`[name="${name}"]`)?.value ?? "";

const readChannels = (article) =>
  parseColor(
    `rgb(${channelValue(article, "channel-r")}, ${channelValue(article, "channel-g")}, ${channelValue(article, "channel-b")})`,
  );

const syncColor = (article, value, source) => {
  const rule = findRule(article?.dataset.ruleId);
  if (!rule || !article) return;
  const color = normalizeColor(value);
  rule.color = color;
  article.style.setProperty("--rule", color);

  const picker = article.querySelector('[name="picker"]');
  const hexField = article.querySelector('[name="hex"]');
  const { r, g, b } = rgbFromHex(color);
  if (picker && source !== "picker") picker.value = color;
  if (hexField && source !== "hex") hexField.value = color;
  if (hexField) hexField.setAttribute("aria-invalid", "false");
  if (source !== "channels") {
    const red = article.querySelector('[name="channel-r"]');
    const green = article.querySelector('[name="channel-g"]');
    const blue = article.querySelector('[name="channel-b"]');
    if (red) red.value = String(r);
    if (green) green.value = String(g);
    if (blue) blue.value = String(b);
  }

  const note = article.querySelector(".color-note");
  if (note) note.textContent = `Tab strip uses ${chromeColorLabel(color)}.`;
  for (const swatch of article.querySelectorAll(".swatch")) {
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color));
  }
};

const buildColorEditor = (rule) => {
  const color = normalizeColor(rule.color);
  const { r, g, b } = rgbFromHex(color);
  const picker = h("input", {
    type: "color",
    name: "picker",
    value: color,
    "aria-label": "Color picker",
  });
  picker.value = color;

  const channel = (name, shortLabel, label, value) => {
    const input = h("input", {
      type: "number",
      name,
      min: "0",
      max: "255",
      step: "1",
      value: String(value),
      inputmode: "numeric",
      placeholder: "0-255",
      "aria-label": label,
    });
    return h("label", { className: "channel" }, [shortLabel, input]);
  };

  const swatches = h(
    "div",
    { className: "swatches", role: "group", "aria-label": "Chrome colors" },
    GROUP_COLORS.map((item) => {
      const button = h("button", {
        type: "button",
        className: "swatch",
        "data-action": "preset",
        "data-color": item.swatch,
        "aria-label": item.label,
        "aria-pressed": item.swatch === color ? "true" : "false",
      });
      button.style.setProperty("--swatch", item.swatch);
      return button;
    }),
  );

  return h("div", { className: "color-editor" }, [
    h("label", { className: "picker" }, [picker]),
    h("div", { className: "color-fields" }, [
      h("input", {
        type: "text",
        name: "hex",
        value: color,
        className: "hex-field",
        spellcheck: "false",
        maxlength: "32",
        autocomplete: "off",
        placeholder: "#ff8800",
        "aria-label": "Hex or RGB color",
      }),
      h("div", { className: "channels" }, [
        channel("channel-r", "R", "Red", r),
        channel("channel-g", "G", "Green", g),
        channel("channel-b", "B", "Blue", b),
      ]),
    ]),
    swatches,
    h("p", { className: "color-note" }, [
      `Tab strip uses ${chromeColorLabel(color)}.`,
    ]),
  ]);
};

const eventElement = (target) => {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
};

const h = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "className") node.className = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return node;
};

const clonePageState = (state) => ({
  rules: state.rules.map((rule) => ({ ...rule, patterns: [...rule.patterns] })),
  settings: { ...state.settings },
});

const applySettingsToForm = () => {
  autoOrganize.checked = page.state.settings.autoOrganizeEnabled === true;
  autoDomain.checked = page.state.settings.autoGroupByDomain === true;
  threshold.value = String(page.state.settings.domainThreshold);
};

const flushEditors = () => {
  for (const field of rulesRoot.querySelectorAll(
    'input[name="name"], textarea[name="patterns"]',
  )) {
    const rule = findRule(field.closest("[data-rule-id]")?.dataset.ruleId);
    if (!rule) continue;
    if (field.name === "name") rule.name = field.value;
    if (field.name === "patterns")
      rule.patterns = parsePatternList(field.value);
  }
};

const persistNow = () => {
  clearTimeout(page.saveTimer);
  flushEditors();
  const snapshot = clonePageState(page.state);
  const ticket = ++saveGeneration;

  if (!page.canSave) {
    setStatus("Load the unpacked extension to save changes.");
    return Promise.resolve();
  }

  saveTail = saveTail.then(async () => {
    try {
      const saved = await saveState(snapshot);
      if (ticket !== saveGeneration) return;
      page.state = saved;
      applySettingsToForm();
      setStatus("Saved.");
      askToApplyColors();
    } catch (error) {
      if (ticket !== saveGeneration) return;
      setStatus(error instanceof Error ? error.message : "Could not save.");
    }
  });

  return saveTail;
};

const askToApplyColors = () => {
  const send = globalThis.chrome?.runtime?.sendMessage;
  if (typeof send !== "function") return;
  void send({ type: MessageType.applyColors }).catch(() => {});
};

const scheduleSave = () => {
  clearTimeout(page.saveTimer);
  page.saveTimer = setTimeout(() => {
    void persistNow();
  }, 400);
};

const renderRule = (rule, index) => {
  const article = h("article", { className: "rule", "data-rule-id": rule.id });
  article.style.setProperty("--rule", normalizeColor(rule.color));
  if (rule.highlight) article.dataset.highlight = "true";

  const name = h("input", {
    type: "text",
    name: "name",
    value: rule.name,
    maxlength: "60",
    placeholder: "Shopping",
    "aria-label": "Group name",
    autocomplete: "off",
  });

  const up = h("button", { type: "button", "data-action": "up" }, ["Up"]);
  const down = h("button", { type: "button", "data-action": "down" }, ["Down"]);
  up.disabled = index === 0;
  down.disabled = index === page.state.rules.length - 1;

  const patterns = h("textarea", {
    name: "patterns",
    rows: "3",
    spellcheck: "false",
    placeholder: "youtube.com\n*.google.com\ngithub.com/pulls",
    "aria-label": `Patterns for ${rule.name || "this rule"}`,
  });
  patterns.value = rule.patterns.join("\n");

  const collapse = h("input", { type: "checkbox", name: "auto-collapse" });
  collapse.checked = rule.autoCollapse === true;

  article.append(
    h("div", { className: "rule-main" }, [name]),
    buildColorEditor(rule),
    patterns,
    h("label", { className: "collapse" }, [
      collapse,
      "Collapse when you are not in it",
    ]),
    h("div", { className: "rule-actions" }, [
      h("div", { className: "moves" }, [up, down]),
      h(
        "button",
        { type: "button", className: "remove", "data-action": "remove" },
        ["Remove"],
      ),
    ]),
  );

  return article;
};

const renderRules = ({ focusSelector } = {}) => {
  rulesRoot.replaceChildren();

  if (page.state.rules.length === 0) {
    rulesRoot.append(
      h("p", { className: "empty" }, [
        "No rules yet. Add one and matching tabs will gather into that group.",
      ]),
    );
    return;
  }

  for (const [index, rule] of page.state.rules.entries()) {
    rulesRoot.append(renderRule(rule, index));
  }

  if (!focusSelector) return;
  rulesRoot.querySelector(focusSelector)?.focus();
};

const highlightRule = (ruleId) => {
  const rule = findRule(ruleId);
  if (rule) rule.highlight = true;
  renderRules();
  const node = rulesRoot.querySelector(
    `[data-rule-id="${CSS.escape(ruleId)}"]`,
  );
  node?.scrollIntoView({ block: "center" });
};

const moveRule = (ruleId, direction) => {
  flushEditors();
  const index = page.state.rules.findIndex((rule) => rule.id === ruleId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= page.state.rules.length)
    return;

  const [rule] = page.state.rules.splice(index, 1);
  page.state.rules.splice(nextIndex, 0, rule);
  const action = direction < 0 ? "up" : "down";
  renderRules({
    focusSelector: `[data-rule-id="${CSS.escape(ruleId)}"] [data-action="${action}"]`,
  });
  void persistNow();
};

const removeRule = (ruleId) => {
  flushEditors();
  page.state.rules = page.state.rules.filter((rule) => rule.id !== ruleId);
  renderRules();
  void persistNow();
};

const addRule = (rule, { toStart = false } = {}) => {
  if (page.state.rules.length >= MAX_RULES) {
    setStatus(`You can keep up to ${MAX_RULES} rules.`);
    return false;
  }

  flushEditors();
  if (toStart) page.state.rules.unshift(rule);
  else page.state.rules.push(rule);

  renderRules({
    focusSelector: `[data-rule-id="${CSS.escape(rule.id)}"] input[name="name"]`,
  });
  const name = rulesRoot.querySelector(
    `[data-rule-id="${CSS.escape(rule.id)}"] input[name="name"]`,
  );
  name?.select();
  return persistNow();
};

const consumeDomainQuery = async () => {
  const current = new URL(location.href);
  const domain = normalizePattern(current.searchParams.get("domain") ?? "");
  if (!domain) return false;

  current.searchParams.delete("domain");
  history.replaceState({}, "", current);

  const patterns = parsePatternList([domain]);
  if (patterns.length === 0) return false;

  const pattern = patterns[0];
  const existing = page.state.rules.find((rule) =>
    rule.patterns.includes(pattern),
  );
  if (existing) {
    highlightRule(existing.id);
    setStatus(`You already have a rule for ${pattern}.`);
    return true;
  }

  const rule = createRule({
    name: titleFromHost(pattern),
    patterns: [pattern],
    color: colorForDomain(pattern),
  });
  const added = await addRule(rule, { toStart: true });
  if (added === false) return true;
  setStatus(`Added ${pattern} at the top so it matches first.`);
  return true;
};

const bindRules = () => {
  rulesRoot.addEventListener("input", (event) => {
    const field = eventElement(event.target);
    const rule = findRule(field?.closest("[data-rule-id]")?.dataset.ruleId);
    if (!rule || !field) return;

    if (field.name === "name") {
      rule.name = field.value;
      scheduleSave();
    }

    if (field.name === "auto-collapse") {
      rule.autoCollapse = field.checked;
      void persistNow();
    }

    if (field.name === "picker") {
      syncColor(field.closest(".rule"), field.value, "picker");
      scheduleSave();
    }

    if (field.name === "hex") {
      const parsed = parseColor(field.value);
      field.setAttribute("aria-invalid", parsed ? "false" : "true");
      if (!parsed) return;
      syncColor(field.closest(".rule"), parsed, "hex");
      scheduleSave();
    }

    if (field.name.startsWith("channel-")) {
      const article = field.closest(".rule");
      const parsed = readChannels(article);
      if (!parsed) return;
      syncColor(article, parsed, "channels");
      scheduleSave();
    }
  });

  rulesRoot.addEventListener("change", (event) => {
    const field = eventElement(event.target);
    if (field?.name !== "picker") return;
    void persistNow();
  });

  rulesRoot.addEventListener("focusout", (event) => {
    const field = eventElement(event.target);
    if (!field) return;
    const article = field.closest(".rule");
    const rule = findRule(article?.dataset.ruleId);
    if (!rule) return;

    if (field.name === "patterns") {
      rule.patterns = parsePatternList(field.value);
      field.value = rule.patterns.join("\n");
      void persistNow();
      return;
    }

    if (field.name === "hex") {
      const parsed = parseColor(field.value);
      if (!parsed) {
        field.value = normalizeColor(rule.color);
        field.setAttribute("aria-invalid", "false");
        return;
      }
      syncColor(article, parsed, "preset");
      void persistNow();
      return;
    }

    if (field.name.startsWith("channel-")) {
      const parsed = readChannels(article);
      if (!parsed) {
        syncColor(article, rule.color, "preset");
        return;
      }
      syncColor(article, parsed, "preset");
      void persistNow();
    }
  });

  rulesRoot.addEventListener("click", (event) => {
    const button = eventElement(event.target)?.closest("[data-action]");
    if (!button || button.name === "auto-collapse") return;
    const ruleId = button.closest("[data-rule-id]")?.dataset.ruleId;
    if (!ruleId) return;

    if (button.dataset.action === "preset") {
      syncColor(button.closest(".rule"), button.dataset.color, "preset");
      void persistNow();
      return;
    }

    if (button.dataset.action === "up") moveRule(ruleId, -1);
    if (button.dataset.action === "down") moveRule(ruleId, 1);
    if (button.dataset.action === "remove") removeRule(ruleId);
  });
};

const bindSettings = () => {
  autoOrganize.addEventListener("change", () => {
    page.state.settings.autoOrganizeEnabled = autoOrganize.checked;
    void persistNow();
  });

  autoDomain.addEventListener("change", () => {
    page.state.settings.autoGroupByDomain = autoDomain.checked;
    void persistNow();
  });

  threshold.addEventListener("change", () => {
    page.state.settings.domainThreshold = Number(threshold.value);
    void persistNow();
  });

  document.querySelector("#add-rule").addEventListener("click", () => {
    addRule(createRule({ color: "blue" }));
  });

  document.querySelector("#export").addEventListener("click", () => {
    flushEditors();
    const blob = new Blob([serializeBackup(page.state)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "autotab-rules.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Exported rules.");
  });

  document.querySelector("#import").addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files ?? [];
    fileInput.value = "";
    if (!file) return;
    if (!window.confirm("Replace the current rules with this file?")) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        page.state = parseBackup(
          String(reader.result ?? ""),
          page.state.settings,
        );
        applySettingsToForm();
        renderRules();
        void persistNow();
        setStatus("Imported rules.");
      } catch (error) {
        if (error instanceof SyntaxError) {
          setStatus("This file isn't valid JSON.");
          return;
        }
        setStatus(
          error instanceof Error ? error.message : "Could not import rules.",
        );
      }
    });
    reader.addEventListener("error", () => {
      setStatus("Could not read that file.");
    });
    reader.readAsText(file);
  });

  window.addEventListener("pagehide", () => {
    flushEditors();
    if (!page.canSave) return;
    void saveState(clonePageState(page.state));
  });
};

const init = async () => {
  page.canSave = extensionAvailable();
  if (page.canSave) {
    try {
      page.state = await loadState();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not load rules.",
      );
    }
  }

  applySettingsToForm();
  renderRules();
  bindRules();
  bindSettings();
  const addedFromTab = await consumeDomainQuery();

  if (!page.canSave && !addedFromTab)
    setStatus("Load the unpacked extension to save changes.");
};

void init();
