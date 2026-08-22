/**
 * ourgroceries-shopping-card  v1.0.0
 * Shopping-list card for a `todo.*` entity (e.g. from Home Assistant's
 * built-in OurGroceries integration), with add-item autocomplete sourced
 * from the companion ourgroceries-autocomplete integration's
 * `ourgroceries_autocomplete.get_suggestions` service.
 *
 * This card never talks to OurGroceries directly — all list reads/writes go
 * through HA's standard `todo.*` services against the entity you configure.
 * Autocomplete degrades gracefully (empty suggestion list, no error shown)
 * if ourgroceries-autocomplete isn't installed.
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
  },
};

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

class OurGroceriesShoppingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._items = [];
    this._suggestions = [];
    this._suggestionsLoaded = false;
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
    this._loading = false;
    this._render();
  }

  async _loadSuggestions() {
    try {
      const result = await this._callServiceWithResponse(
        "ourgroceries_autocomplete",
        "get_suggestions"
      );
      this._suggestions = result?.response?.items || [];
    } catch (e) {
      // Autocomplete is an enhancement, not a requirement — degrade
      // silently (empty datalist) if the companion integration isn't
      // installed or the call fails for any reason.
      this._suggestions = [];
    }
    this._suggestionsLoaded = true;
    this._render();
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

  // ─── Render ────────────────────────────────────────────────────────────

  _render() {
    const cfg = this._config;
    if (!cfg) return;

    const title = esc(cfg.title || this._hass?.states[cfg.entity]?.attributes?.friendly_name || "");
    const datalistId = `ourgroceries-suggestions-${this._instanceId}`;

    const rows = this._items
      .map((item) => {
        const done = item.status === "completed";
        return `
          <div class="row${done ? " done" : ""}">
            <input type="checkbox" data-uid="${esc(item.uid)}" ${done ? "checked" : ""} aria-label="${esc(item.summary)}">
            <span class="summary">${esc(item.summary)}</span>
            <button class="remove" data-uid="${esc(item.uid)}" aria-label="${t(this._hass, "remove")}: ${esc(item.summary)}">✕</button>
          </div>`;
      })
      .join("");

    const body = this._loading
      ? `<div class="status">${t(this._hass, "loading")}</div>`
      : this._error
        ? `<div class="status error">${t(this._hass, "error")}</div>`
        : this._items.length === 0
          ? `<div class="status">${t(this._hass, "empty")}</div>`
          : `<div class="rows">${rows}</div>`;

    const suggestionOptions = this._suggestions.map((s) => `<option value="${esc(s)}">`).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 14px 16px 16px; }
        .header { font-size: 16px; font-weight: 500; color: var(--primary-text-color); margin-bottom: 10px; }
        .status { font-size: 13px; color: var(--secondary-text-color); padding: 12px 0; }
        .status.error { color: var(--error-color, #db4437); }
        .rows { display: flex; flex-direction: column; }
        .row {
          display: flex; align-items: center; gap: 10px;
          padding: 7px 0; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2));
        }
        .row:last-child { border-bottom: none; }
        .row input[type="checkbox"] { flex-shrink: 0; width: 18px; height: 18px; accent-color: var(--primary-color); cursor: pointer; }
        .row .summary { flex: 1; font-size: 14px; color: var(--primary-text-color); word-break: break-word; }
        .row.done .summary { color: var(--secondary-text-color); text-decoration: line-through; }
        .row .remove {
          flex-shrink: 0; border: none; background: transparent; cursor: pointer;
          color: var(--secondary-text-color); font-size: 13px; padding: 4px 6px; border-radius: 6px;
          opacity: 0; transition: opacity .15s, color .15s;
        }
        .row:hover .remove, .row .remove:focus-visible { opacity: 1; }
        .row .remove:hover { color: var(--error-color, #db4437); }
        .add-row { display: flex; gap: 8px; margin-top: 12px; }
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
      </style>
      <ha-card>
        ${title ? `<div class="header">${title}</div>` : ""}
        ${body}
        <form class="add-row">
          <input type="text" list="${datalistId}" placeholder="${t(this._hass, "add_placeholder")}" aria-label="${t(this._hass, "add_item")}">
          <datalist id="${datalistId}">${suggestionOptions}</datalist>
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
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = form.querySelector("input");
        this._addItem(input.value);
        input.value = "";
      });
    }
  }
}

customElements.define("ourgroceries-shopping-card", OurGroceriesShoppingCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ourgroceries-shopping-card",
  name: "OurGroceries Shopping Card",
  description: "Shopping list card for a todo entity, with add-item autocomplete from your OurGroceries item history",
});
