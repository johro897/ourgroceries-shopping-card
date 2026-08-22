/**
 * ourgroceries-shopping-card  v1.2.1
 * Shopping-list card for a `todo.*` entity (e.g. from the companion
 * ourgroceries-sync integration, or any other todo.* source), with
 * add-item suggestions sourced from ourgroceries-sync's
 * `ourgroceries_sync.get_suggestions` service, grouped by category from
 * `ourgroceries_sync.get_categories`.
 *
 * This card never talks to OurGroceries directly — all list reads/writes go
 * through HA's standard `todo.*` services against the entity you configure.
 * Both suggestions and category grouping degrade gracefully (no suggestions,
 * flat ungrouped list) if ourgroceries-sync isn't installed, or if the
 * configured entity comes from a different todo.* source entirely.
 *
 * Configuration:
 *   type: custom:ourgroceries-shopping-card
 *   entity: todo.groceries   # required
 *   title: Groceries         # optional, defaults to the entity's own name
 */

let INSTANCE_COUNT = 0;

const DEFAULT_LANG = "en";
const TRANSLATIONS = {
  en: {
    entity_required: "entity is required",
    add_placeholder: "Add an item…",
    add_item: "Add item",
    add: "Add",
    remove: "Remove",
    loading: "Loading…",
    error: "Could not load this list. Check that the entity ID is correct.",
    empty: "Nothing on the list yet.",
    uncategorized: "Other",
    suggestions_hint: "From your OurGroceries history — click to add directly",
  },
  sv: {
    entity_required: "entity krävs",
    add_placeholder: "Lägg till en vara…",
    add_item: "Lägg till vara",
    add: "Lägg till",
    remove: "Ta bort",
    loading: "Laddar…",
    error: "Kunde inte läsa listan. Kontrollera att entity-id stämmer.",
    empty: "Inget på listan än.",
    uncategorized: "Övrigt",
    suggestions_hint: "Från din OurGroceries-historik — klicka för att lägga till direkt",
  },
};

// Muted, consistent-chroma hues a category name is hashed into, so a given
// category keeps the same color across reloads. OurGroceries' API doesn't
// expose a color per category, so this is entirely client-side — not data
// from OurGroceries.
const CATEGORY_HUES = [210, 55, 300, 140, 20, 260];

function t(hass, key) {
  const raw = (hass?.locale?.language || hass?.language || DEFAULT_LANG).toLowerCase();
  const lang = TRANSLATIONS[raw.split("-")[0]] ? raw.split("-")[0] : DEFAULT_LANG;
  return TRANSLATIONS[lang][key] ?? TRANSLATIONS[DEFAULT_LANG][key] ?? key;
}

function esc(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function categoryColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = CATEGORY_HUES[hash % CATEGORY_HUES.length];
  return `oklch(56% 0.10 ${hue})`;
}

function highlightMatch(name, query) {
  if (!query) return esc(name);
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(name);
  return `${esc(name.slice(0, idx))}<b>${esc(name.slice(idx, idx + query.length))}</b>${esc(name.slice(idx + query.length))}`;
}

class OurGroceriesShoppingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._items = [];
    this._suggestions = [];
    this._suggestionsLoaded = false;
    // null = not yet known whether the backing integration supports
    // categories at all; {} (or populated) = it does, even if this
    // particular list has no categorized items right now.
    this._categories = null;
    this._loading = true;
    this._error = false;
    this._lastState = null;
    this._instanceId = ++INSTANCE_COUNT;
  }

  setConfig(config) {
    if (!config.entity) throw new Error(t(this._hass, "entity_required"));
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const prevHass = this._hass;
    this._hass = hass;

    if (!this._config) return;

    const state = hass.states[this._config.entity]?.state;
    const stateChanged = state !== this._lastState;
    this._lastState = state;

    if (!prevHass) {
      // First hass — load everything.
      this._loadItems();
      this._loadSuggestions();
      return;
    }

    if (stateChanged) this._loadItems();
  }

  getCardSize() {
    return 3;
  }

  // ─── Data ──────────────────────────────────────────────────────────────

  async _callServiceWithResponse(domain, service, serviceData, target) {
    const message = { type: "call_service", domain, service, return_response: true };
    if (serviceData) message.service_data = serviceData;
    if (target) message.target = target;
    return this._hass.connection.sendMessagePromise(message);
  }

  async _loadItems() {
    this._loading = this._items.length === 0;
    this._error = false;
    this._render();
    try {
      const result = await this._callServiceWithResponse(
        "todo",
        "get_items",
        {},
        { entity_id: this._config.entity }
      );
      this._items = result?.response?.[this._config.entity]?.items || [];
    } catch (e) {
      console.error("ourgroceries-shopping-card: failed to load items", e);
      this._error = true;
    }
    await this._loadCategories();
    this._loading = false;
    this._render();
  }

  async _loadCategories() {
    try {
      const result = await this._callServiceWithResponse(
        "ourgroceries_sync",
        "get_categories",
        {},
        { entity_id: this._config.entity }
      );
      // Categories genuinely available (even if empty for this list right
      // now) vs. not supported at all are both "no error" — either is fine,
      // grouping just falls back to a single "Other" bucket if empty.
      this._categories = result?.response?.categories || {};
    } catch (e) {
      // Companion integration not installed, or this entity isn't one of
      // its lists — degrade to a flat, ungrouped list, same as suggestions.
      this._categories = null;
    }
  }

  async _loadSuggestions() {
    try {
      const result = await this._callServiceWithResponse(
        "ourgroceries_sync",
        "get_suggestions"
      );
      this._suggestions = result?.response?.items || [];
    } catch (e) {
      // Suggestions are an enhancement, not a requirement — degrade
      // silently (empty list) if the companion integration isn't
      // installed or the call fails for any reason.
      this._suggestions = [];
    }
    this._suggestionsLoaded = true;
    // Suggestions load asynchronously after the card mounts — if the user
    // already focused the add-item field before they arrived, refresh the
    // (until-now empty) dropdown now that there's something to show.
    const input = this.shadowRoot.querySelector(".add-row input");
    if (input && this.shadowRoot.activeElement === input) {
      this._updateSuggestionsDropdown(input.value);
    }
  }

  async _addItem(text) {
    const value = text.trim();
    if (!value) return;
    await this._hass.callService("todo", "add_item", { item: value }, { entity_id: this._config.entity });
    await this._loadItems();
  }

  async _toggleItem(item) {
    const status = item.status === "completed" ? "needs_action" : "completed";
    await this._hass.callService(
      "todo",
      "update_item",
      { item: item.uid, status },
      { entity_id: this._config.entity }
    );
    await this._loadItems();
  }

  async _removeItem(item) {
    await this._hass.callService(
      "todo",
      "remove_item",
      { item: [item.uid] },
      { entity_id: this._config.entity }
    );
    await this._loadItems();
  }

  // ─── Grouping ──────────────────────────────────────────────────────────

  _groupedItems() {
    if (!this._categories) return null; // signal: render flat, no headers
    const other = t(this._hass, "uncategorized");
    const order = [];
    const groups = new Map();
    for (const item of this._items) {
      const name = this._categories[item.uid] || other;
      if (!groups.has(name)) {
        groups.set(name, []);
        order.push(name);
      }
      groups.get(name).push(item);
    }
    order.sort((a, b) => (a === other ? 1 : 0) - (b === other ? 1 : 0));
    return order.map((name) => ({ name, items: groups.get(name) }));
  }

  // ─── Render ────────────────────────────────────────────────────────────

  _renderRow(item) {
    const done = item.status === "completed";
    return `
      <div class="row${done ? " done" : ""}">
        <input type="checkbox" data-uid="${esc(item.uid)}" ${done ? "checked" : ""} aria-label="${esc(item.summary)}">
        <span class="summary-block">
          <span class="summary">${esc(item.summary)}</span>
          ${item.description ? `<span class="note">${esc(item.description)}</span>` : ""}
        </span>
        <button class="remove" data-uid="${esc(item.uid)}" aria-label="${t(this._hass, "remove")}: ${esc(item.summary)}">✕</button>
      </div>`;
  }

  _renderList() {
    const grouped = this._groupedItems();
    if (!grouped) {
      return `<div class="rows">${this._items.map((item) => this._renderRow(item)).join("")}</div>`;
    }
    return grouped
      .map(
        (group) => `
          <div class="group">
            <div class="group-header" style="background:${categoryColor(group.name)}">${esc(group.name)}</div>
            ${group.items.map((item) => this._renderRow(item)).join("")}
          </div>`
      )
      .join("");
  }

  _suggestionsMarkup(query) {
    const q = query.trim();
    const matches = this._suggestions
      .filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 8);
    if (matches.length === 0) return "";
    const rows = matches
      .map(
        (s) => `
          <div class="suggestion-row" data-name="${esc(s.name)}">
            <span class="suggestion-name">${highlightMatch(s.name, q)}</span>
            ${s.note ? `<span class="suggestion-note">${esc(s.note)}</span>` : ""}
          </div>`
      )
      .join("");
    return `
      <div class="suggestions-list">${rows}</div>
      <div class="suggestions-hint">${t(this._hass, "suggestions_hint")}</div>`;
  }

  _updateSuggestionsDropdown(query) {
    const box = this.shadowRoot.querySelector(".suggestions-box");
    if (!box) return;
    const markup = this._suggestionsMarkup(query);
    box.innerHTML = markup;
    box.style.display = markup ? "block" : "none";
  }

  _render() {
    const cfg = this._config;
    if (!cfg) return;

    const title = esc(cfg.title || this._hass?.states[cfg.entity]?.attributes?.friendly_name || "");

    const body = this._loading
      ? `<div class="status">${t(this._hass, "loading")}</div>`
      : this._error
        ? `<div class="status error">${t(this._hass, "error")}</div>`
        : this._items.length === 0
          ? `<div class="status">${t(this._hass, "empty")}</div>`
          : this._renderList();

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 14px 16px 16px; }
        .header { font-size: 16px; font-weight: 500; color: var(--primary-text-color); margin-bottom: 10px; }
        .status { font-size: 13px; color: var(--secondary-text-color); padding: 12px 0; }
        .status.error { color: var(--error-color, #db4437); }
        .rows { display: flex; flex-direction: column; }

        .group { display: flex; flex-direction: column; }
        .group-header {
          color: #fff; font-size: 12px; font-weight: 600; letter-spacing: .03em;
          text-transform: uppercase; padding: 7px 12px; border-radius: 8px;
          margin: 14px 0 4px;
        }
        .group:first-of-type .group-header { margin-top: 0; }

        .row {
          display: flex; align-items: center; gap: 10px;
          padding: 7px 0; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2));
        }
        .rows .row:last-child, .group .row:last-child { border-bottom: none; }
        .row input[type="checkbox"] { flex-shrink: 0; width: 18px; height: 18px; accent-color: var(--primary-color); cursor: pointer; }
        .row .summary-block { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .row .summary { font-size: 14px; color: var(--primary-text-color); word-break: break-word; }
        .row .note { font-size: 11px; color: var(--secondary-text-color); }
        .row.done .summary { color: var(--secondary-text-color); text-decoration: line-through; }
        .row .remove {
          flex-shrink: 0; border: none; background: transparent; cursor: pointer;
          color: var(--secondary-text-color); font-size: 13px; padding: 4px 6px; border-radius: 6px;
          opacity: 0; transition: opacity .15s, color .15s;
        }
        .row:hover .remove, .row .remove:focus-visible { opacity: 1; }
        .row .remove:hover { color: var(--error-color, #db4437); }

        .add-row { display: flex; gap: 8px; margin-top: 14px; position: relative; }
        .add-row input {
          flex: 1; min-width: 0; padding: 8px 10px; border-radius: 8px;
          border: 1px solid var(--divider-color, rgba(127,127,127,.3));
          background: var(--card-background-color, transparent);
          color: var(--primary-text-color); font-size: 14px; font-family: inherit;
        }
        .add-row input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        .add-row button {
          flex-shrink: 0; padding: 8px 14px; border-radius: 8px; border: none;
          background: var(--primary-color); color: var(--text-primary-color, #fff);
          font-size: 14px; font-family: inherit; cursor: pointer;
        }
        .add-row button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

        .suggestions-box {
          display: none;
          position: absolute; top: 100%; left: 0; right: 0; margin-top: 6px;
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color, rgba(127,127,127,.3));
          border-radius: 10px;
          box-shadow: 0 6px 16px rgba(0,0,0,.18);
          overflow: hidden; z-index: 1;
        }
        .suggestions-list { max-height: 240px; overflow-y: auto; }
        .suggestion-row {
          display: flex; align-items: baseline; gap: 8px;
          padding: 10px 14px; font-size: 14px; color: var(--primary-text-color);
          cursor: pointer; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2));
        }
        .suggestion-row:last-child { border-bottom: none; }
        .suggestion-row:hover { background: var(--secondary-background-color, rgba(127,127,127,.08)); }
        .suggestion-name b { font-weight: 700; }
        .suggestion-note { font-size: 12px; color: var(--secondary-text-color); }
        .suggestions-hint {
          padding: 6px 14px; font-size: 11px; color: var(--secondary-text-color);
          border-top: 1px solid var(--divider-color, rgba(127,127,127,.2));
        }
      </style>
      <ha-card>
        ${title ? `<div class="header">${title}</div>` : ""}
        ${body}
        <form class="add-row">
          <div class="suggestions-box"></div>
          <input type="text" placeholder="${t(this._hass, "add_placeholder")}" aria-label="${t(this._hass, "add_item")}" autocomplete="off">
          <button type="submit">${t(this._hass, "add")}</button>
        </form>
      </ha-card>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    this.shadowRoot.querySelectorAll(".row input[type=checkbox]").forEach((el) => {
      el.addEventListener("change", () => {
        const item = this._items.find((i) => i.uid === el.dataset.uid);
        if (item) this._toggleItem(item);
      });
    });
    this.shadowRoot.querySelectorAll(".row .remove").forEach((el) => {
      el.addEventListener("click", () => {
        const item = this._items.find((i) => i.uid === el.dataset.uid);
        if (item) this._removeItem(item);
      });
    });

    const form = this.shadowRoot.querySelector(".add-row");
    if (!form) return;
    const input = form.querySelector("input");
    const box = form.querySelector(".suggestions-box");

    const closeDropdown = () => {
      box.innerHTML = "";
      box.style.display = "none";
    };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this._addItem(input.value);
      input.value = "";
      closeDropdown();
    });

    input.addEventListener("input", () => this._updateSuggestionsDropdown(input.value));
    input.addEventListener("focus", () => this._updateSuggestionsDropdown(input.value));
    input.addEventListener("blur", closeDropdown);

    // mousedown (not click) fires before the input's blur, so a suggestion
    // can be picked without the dropdown closing first.
    box.addEventListener("mousedown", (e) => {
      const row = e.target.closest(".suggestion-row");
      if (!row) return;
      e.preventDefault();
      this._addItem(row.dataset.name);
      input.value = "";
      closeDropdown();
    });
  }
}

customElements.define("ourgroceries-shopping-card", OurGroceriesShoppingCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ourgroceries-shopping-card",
  name: "OurGroceries Shopping Card",
  description: "Shopping list card for a todo entity, with category grouping and click-to-add suggestions from your OurGroceries item history",
});
