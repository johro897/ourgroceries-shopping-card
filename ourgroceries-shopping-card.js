/**
 * ourgroceries-shopping-card  v1.5.1
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
 * Has a visual editor, or configure directly:
 *   type: custom:ourgroceries-shopping-card
 *   entity: todo.groceries   # required
 *   title: Groceries         # optional, defaults to the entity's own name
 *   panel: false             # optional — two-column layout for a tablet/
 *                             # panel-view dashboard (suggestions become an
 *                             # always-visible column instead of a dropdown)
 *   input_position: bottom   # optional — "top" puts the add field above the
 *                             # list (compact layout only)
 *   max_height: 480          # optional — px number or CSS length; the list
 *                             # then scrolls inside the card
 *
 * In a sections view the card follows grid_options.rows: set rows (e.g. 8)
 * and the card fills exactly that height, with the list scrolling inside.
 * Without rows it keeps its natural height, as before.
 */

let INSTANCE_COUNT = 0;

const DEFAULT_LANG = "en";
const TRANSLATIONS = {
  en: {
    entity_required: "entity is required",
    add_placeholder: "e.g. Milk, 1.5%",
    add_item: "Add item",
    add: "Add",
    remove: "Remove",
    loading: "Loading…",
    error: "Could not load this list. Check that the entity ID is correct.",
    empty: "Nothing on the list yet.",
    uncategorized: "No category",
    suggestions_hint: "From your OurGroceries history — click to add directly",
    suggestions_header: "Suggestions",
    no_suggestions: "No matches",
    all_done: "All done!",
    completed_count: "{n} crossed off",
    clear_completed: "Clear crossed off",
    editor_entity: "Entity",
    editor_title: "Title",
    editor_panel: "Panel layout (two columns, for a tablet/panel-view dashboard)",
    editor_input_position: "Add field position (compact layout)",
    editor_max_height: "Max height, e.g. 480 or 60vh (optional; in a sections view use the card's grid rows instead)",
    input_bottom: "Below the list",
    input_top: "Above the list",
  },
  sv: {
    entity_required: "entity krävs",
    add_placeholder: "t.ex. Mjölk, 1.5%",
    add_item: "Lägg till vara",
    add: "Lägg till",
    remove: "Ta bort",
    loading: "Laddar…",
    error: "Kunde inte läsa listan. Kontrollera att entity-id stämmer.",
    empty: "Inget på listan än.",
    uncategorized: "Ingen kategori",
    suggestions_hint: "Från din OurGroceries-historik — klicka för att lägga till direkt",
    suggestions_header: "Förslag",
    no_suggestions: "Inga träffar",
    all_done: "Allt avklarat!",
    completed_count: "{n} avbockade",
    clear_completed: "Rensa avbockade",
    editor_entity: "Entitet",
    editor_title: "Titel",
    editor_panel: "Panel-layout (två kolumner, för en surfplatta/panel-vy)",
    editor_input_position: "Inmatningsfältets placering (kompakt layout)",
    editor_max_height: "Maxhöjd, t.ex. 480 eller 60vh (valfritt; i en sektionsvy, använd kortets rader istället)",
    input_bottom: "Under listan",
    input_top: "Ovanför listan",
  },
};

// Muted, consistent-chroma hues a category name is hashed into, so a given
// category keeps the same color across reloads. OurGroceries' API doesn't
// expose a color per category, so this is entirely client-side — not data
// from OurGroceries.
const CATEGORY_HUES = [210, 55, 300, 140, 20, 260];

function t(hass, key, replacements) {
  const raw = (hass?.locale?.language || hass?.language || DEFAULT_LANG).toLowerCase();
  const lang = TRANSLATIONS[raw.split("-")[0]] ? raw.split("-")[0] : DEFAULT_LANG;
  const str = TRANSLATIONS[lang][key] ?? TRANSLATIONS[DEFAULT_LANG][key] ?? key;
  if (!replacements) return str;
  return str.replace(/\{([^}]+)\}/g, (match, k) =>
    Object.prototype.hasOwnProperty.call(replacements, k) ? replacements[k] : match
  );
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

// Shared between compact and panel layouts — the list itself (rows, category
// group headers, suggestion rows) looks identical in both; only how the
// add/suggestions area is arranged around it differs.
const ROW_STYLES = `
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
  .row .check { display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; }
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

  .suggestion-row {
    display: flex; align-items: baseline; gap: 8px;
    padding: 10px 14px; font-size: 14px; color: var(--primary-text-color);
    cursor: pointer; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2));
  }
  .suggestion-row:last-child { border-bottom: none; }
  .suggestion-row:hover { background: var(--secondary-background-color, rgba(127,127,127,.08)); }
  .suggestion-name b { font-weight: 700; }
  .suggestion-note { font-size: 12px; color: var(--secondary-text-color); }

  .completed-toggle {
    display: flex; align-items: center; gap: 6px; width: 100%;
    margin-top: 10px; padding: 8px 4px; border: none; background: transparent;
    color: var(--secondary-text-color); font-size: 13px; font-family: inherit;
    cursor: pointer; border-radius: 6px; text-align: left;
  }
  .completed-toggle:hover, .completed-toggle:focus-visible { background: var(--secondary-background-color, rgba(127,127,127,.08)); }
  .completed-toggle .chevron { display: inline-block; width: 1em; flex-shrink: 0; }
  .completed-rows { margin-top: 4px; }
  .clear-completed {
    margin: 8px 0 2px; padding: 6px 10px; border-radius: 6px;
    border: 1px solid var(--divider-color, rgba(127,127,127,.3)); background: transparent;
    color: var(--secondary-text-color); font-size: 12px; font-family: inherit; cursor: pointer;
  }
  .clear-completed:hover, .clear-completed:focus-visible { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437); }
`;

// Touch screens only (tablet, phone) — mouse/desktop rendering is untouched.
// ≥44px hit areas, the remove button always visible (there is no hover on a
// touch screen, so before this it was effectively invisible there), and a
// slightly larger, more readable text size.
const TOUCH_STYLES = `
  @media (pointer: coarse) {
    .row { gap: 4px; padding: 2px 0; min-height: 48px; }
    .row .check { width: 44px; height: 44px; margin-left: -11px; }
    .row input[type="checkbox"] { width: 22px; height: 22px; margin: 0; }
    .row .summary { font-size: 16px; }
    .row .note { font-size: 13px; }
    .row .remove {
      opacity: 1; width: 44px; height: 44px; margin-right: -10px;
      font-size: 16px; padding: 0;
    }
    .suggestion-row { min-height: 48px; box-sizing: border-box; align-items: center; font-size: 16px; }
    .suggestion-note { font-size: 13px; }
    .completed-toggle { min-height: 44px; font-size: 14px; }
    .clear-completed { min-height: 44px; padding: 0 14px; font-size: 14px; }
    .add-row input, .panel-add-row input { min-height: 44px; box-sizing: border-box; font-size: 16px; }
    .add-row button, .panel-add-row button { min-height: 44px; box-sizing: border-box; padding: 0 16px; font-size: 15px; }
  }
`;

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
    // Pure UI state (not persisted across reloads of the page) — survives
    // across _render() calls since it lives on the instance, not reset by
    // the add/toggle/remove cycle that re-renders after every action.
    this._showCompleted = false;
    // The card shell (header, add row, list container) is only rebuilt when
    // this key changes; ordinary list refreshes only swap the list region,
    // so the add field keeps its focus/value (and a touch keyboard stays up).
    this._shellKey = null;
    this._layout = undefined;
  }

  setConfig(config) {
    if (!config.entity) throw new Error(t(this._hass, "entity_required"));
    this._config = config;
    this._render();
  }

  // Set by HA's hui-card: "grid" inside a sections view, "panel" in a panel
  // view, undefined in masonry. Reflected as an attribute so the CSS can fill
  // the grid cell's height ONLY in a sections grid — elsewhere the card keeps
  // its natural height, exactly as before.
  set layout(value) {
    this._layout = value;
    if (value) this.setAttribute("layout", value);
    else this.removeAttribute("layout");
  }

  get layout() {
    return this._layout;
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

  // Sections view: same defaults HA uses for a card without this method
  // (full width, auto height), so nothing changes unless the dashboard sets
  // grid_options.rows — then the card fills that height and scrolls inside.
  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6, min_rows: 2 };
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
    // Suggestions load asynchronously after the card mounts. In panel mode
    // the suggestions list is always visible, so just refresh it outright;
    // in compact mode it's a dropdown that only matters if the user already
    // focused the add-item field before the suggestions arrived.
    if (this._config?.panel) {
      const input = this.shadowRoot.querySelector(".panel-add-row input");
      this._updatePanelSuggestions(input?.value || "");
    } else {
      const input = this.shadowRoot.querySelector(".add-row input");
      if (input && this.shadowRoot.activeElement === input) {
        this._updateSuggestionsDropdown(input.value);
      }
    }
  }

  // Inline note syntax for the add-item field: text after the first comma
  // is a note, e.g. "Milk, 1.5%" -> {item: "Milk", note: "1.5%"}. An item
  // name that itself contains a comma (rare, but real — "Ben & Jerry's,
  // Cookie Dough") will have it split off as a note too; that's an accepted
  // trade-off of this syntax over a second input field, not a bug.
  _parseAddInput(raw) {
    const idx = raw.indexOf(",");
    if (idx === -1) return { item: raw.trim(), note: null };
    const item = raw.slice(0, idx).trim();
    const note = raw.slice(idx + 1).trim();
    return { item, note: note || null };
  }

  async _addItem(text) {
    const value = text.trim();
    if (!value) return;
    await this._hass.callService("todo", "add_item", { item: value }, { entity_id: this._config.entity });
    await this._loadItems();
  }

  // Only used when a suggestion carries a note — todo.add_item has no way
  // to set one (would need SET_DESCRIPTION_ON_ITEM, which ourgroceries-sync
  // deliberately doesn't declare, since that'd also imply description
  // *editing*, which isn't actually supported — see ourgroceries-sync's
  // CLAUDE.md). ourgroceries_sync.add_item bypasses todo.add_item entirely
  // for this one case.
  async _addItemWithNote(text, note) {
    const value = text.trim();
    if (!value) return;
    try {
      await this._hass.callService(
        "ourgroceries_sync",
        "add_item",
        note ? { item: value, note } : { item: value },
        { entity_id: this._config.entity }
      );
    } catch (e) {
      // Companion service unavailable for some reason — still add the
      // item, just without its note, rather than doing nothing.
      await this._hass.callService("todo", "add_item", { item: value }, { entity_id: this._config.entity });
    }
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

  // Bulk-remove in a SINGLE service call (one array of uids), not a loop of
  // single-item calls. HA's todo integration routes a multi-uid remove_item
  // call to the entity's async_delete_todo_items() as one batch — that's
  // the method ourgroceries-sync wraps in a concurrency-limiting semaphore
  // (see its CLAUDE.md) to stay under OurGroceries' request-rate cap. A
  // loop of single-item calls here would bypass that protection entirely,
  // since each call would only ever have one item to fan out.
  async _removeItems(items) {
    if (items.length === 0) return;
    await this._hass.callService(
      "todo",
      "remove_item",
      { item: items.map((i) => i.uid) },
      { entity_id: this._config.entity }
    );
    await this._loadItems();
  }

  // ─── Grouping ──────────────────────────────────────────────────────────

  _activeItems() {
    return this._items.filter((i) => i.status !== "completed");
  }

  _completedItems() {
    return this._items.filter((i) => i.status === "completed");
  }

  _groupedItems(items) {
    if (!this._categories) return null; // signal: render flat, no headers
    const other = t(this._hass, "uncategorized");
    const order = [];
    const groups = new Map();
    for (const item of items) {
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
        <label class="check"><input type="checkbox" data-uid="${esc(item.uid)}" ${done ? "checked" : ""} aria-label="${esc(item.summary)}"></label>
        <span class="summary-block">
          <span class="summary">${esc(item.summary)}</span>
          ${item.description ? `<span class="note">${esc(item.description)}</span>` : ""}
        </span>
        <button class="remove" data-uid="${esc(item.uid)}" aria-label="${t(this._hass, "remove")}: ${esc(item.summary)}">✕</button>
      </div>`;
  }

  _renderList(items) {
    const grouped = this._groupedItems(items);
    if (!grouped) {
      return `<div class="rows">${items.map((item) => this._renderRow(item)).join("")}</div>`;
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

  _filteredSuggestions(query, limit) {
    const q = query.trim().toLowerCase();
    return this._suggestions.filter((s) => !q || s.name.toLowerCase().includes(q)).slice(0, limit);
  }

  _suggestionRowsHtml(matches, query) {
    return matches
      .map(
        (s) => `
          <div class="suggestion-row" data-name="${esc(s.name)}">
            <span class="suggestion-name">${highlightMatch(s.name, query)}</span>
            ${s.note ? `<span class="suggestion-note">${esc(s.note)}</span>` : ""}
          </div>`
      )
      .join("");
  }

  _suggestionsMarkup(query) {
    const matches = this._filteredSuggestions(query, 8);
    if (matches.length === 0) return "";
    return `
      <div class="suggestions-list">${this._suggestionRowsHtml(matches, query.trim())}</div>
      <div class="suggestions-hint">${t(this._hass, "suggestions_hint")}</div>`;
  }

  _updateSuggestionsDropdown(query) {
    const box = this.shadowRoot.querySelector(".suggestions-box");
    if (!box) return;
    const markup = this._suggestionsMarkup(query);
    box.innerHTML = markup;
    box.style.display = markup ? "block" : "none";
    if (markup) this._placeSuggestionsBox(box);
  }

  // Open toward the side of the viewport with room, and cap the list to that
  // room so it is never cut off. Opens downward as before whenever there is
  // reasonable space below; flips up only when there isn't (e.g. the add row
  // at the bottom of a fixed-height card near the bottom of a tablet screen).
  _placeSuggestionsBox(box) {
    const row = box.parentElement;
    const list = box.querySelector(".suggestions-list");
    if (!row || !list) return;
    const rect = row.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    const below = viewport - rect.bottom;
    const above = rect.top;
    const up = below < 200 && above > below;
    box.classList.toggle("up", up);
    // 6px gap + the hint line (~28px) + a little breathing room.
    const room = Math.floor((up ? above : below) - 48);
    list.style.maxHeight = `${Math.max(96, Math.min(240, room))}px`;
  }

  // Panel mode's suggestions column has no visibility toggle — it's always
  // shown — and no cap worth mentioning, since there's a real scrollable
  // area for it rather than a small floating dropdown.
  _panelSuggestionsMarkup(query) {
    const matches = this._filteredSuggestions(query, 200);
    if (matches.length === 0) return `<div class="status">${t(this._hass, "no_suggestions")}</div>`;
    return this._suggestionRowsHtml(matches, query.trim());
  }

  _updatePanelSuggestions(query) {
    const list = this.shadowRoot.querySelector(".panel-suggest-list");
    if (list) list.innerHTML = this._panelSuggestionsMarkup(query);
  }

  _render() {
    if (!this._config) return;
    const key = this._computeShellKey();
    if (key !== this._shellKey || !this.shadowRoot.querySelector(".list-region")) {
      this._shellKey = key;
      if (this._config.panel) {
        this._renderPanelShell();
      } else {
        this._renderCompactShell();
      }
    }
    this._renderListRegion();
  }

  // Everything the shell's markup depends on. Item data is NOT part of it —
  // that only ever touches the list region.
  _computeShellKey() {
    const cfg = this._config;
    return JSON.stringify([
      !!cfg.panel,
      this._inputPosition(),
      cfg.max_height ?? null,
      this._title(),
      t(this._hass, "add_placeholder"),
    ]);
  }

  _title() {
    const cfg = this._config;
    return cfg.title || this._hass?.states[cfg.entity]?.attributes?.friendly_name || "";
  }

  _inputPosition() {
    return this._config.input_position === "top" ? "top" : "bottom";
  }

  // max_height: a number (px) or any CSS length string ("60vh", "480px").
  _maxHeightCss() {
    const v = this._config.max_height;
    if (v === undefined || v === null || v === "") return null;
    if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) return `${Number(v)}px`;
    return String(v).trim().replace(/[;{}<>"]/g, "");
  }

  // Shared by both layouts: in a sections grid (layout="grid") the host and
  // ha-card fill the cell; with max_height the card is capped. In both cases
  // ha-card gets the "constrained" class and the list scrolls inside it.
  // Without either, every rule below resolves to the card's natural height.
  _shellStyles() {
    return `
      :host { display: block; }
      :host([layout="grid"]) { height: 100%; }
      ha-card { padding: 14px 16px 16px; box-sizing: border-box; display: flex; flex-direction: column; }
      :host([layout="grid"]) ha-card { height: 100%; }
      .header { flex-shrink: 0; }
      .list-scroll { flex: 1 1 auto; min-height: 0; }
      :host([layout="grid"]) .list-scroll, ha-card.capped .list-scroll {
        overflow-y: auto; overscroll-behavior: contain;
        margin: 0 -16px; padding: 0 16px;
      }
      ${ROW_STYLES}
      /* Before 1.6 the groups were siblings of the title <div>, so with a
         title the first group never matched :first-of-type and kept its
         14px top margin. Kept identical now that groups live in .list-region. */
      .header + .list-scroll .group:first-of-type .group-header { margin-top: 14px; }
    `;
  }

  _haCardAttrs() {
    const max = this._maxHeightCss();
    return max ? ` class="capped" style="max-height:${esc(max)}"` : "";
  }

  _addFormHtml(cls) {
    return `
      <form class="${cls}">
        ${cls.startsWith("add-row") ? `<div class="suggestions-box"></div>` : ""}
        <input type="text" placeholder="${t(this._hass, "add_placeholder")}" aria-label="${t(this._hass, "add_item")}" autocomplete="off">
        <button type="submit">${t(this._hass, "add")}</button>
      </form>`;
  }

  _renderCompactShell() {
    const title = esc(this._title());
    const top = this._inputPosition() === "top";

    this.shadowRoot.innerHTML = `
      <style>
        ${this._shellStyles()}

        .add-row { display: flex; gap: 8px; margin-top: 14px; position: relative; flex-shrink: 0; }
        .add-row.top { margin-top: 0; margin-bottom: 12px; }
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
          overflow: hidden; z-index: 4;
        }
        .suggestions-box.up { top: auto; bottom: 100%; margin-top: 0; margin-bottom: 6px; }
        .suggestions-list { max-height: 240px; overflow-y: auto; overscroll-behavior: contain; }
        .suggestions-hint {
          padding: 6px 14px; font-size: 11px; color: var(--secondary-text-color);
          border-top: 1px solid var(--divider-color, rgba(127,127,127,.2));
        }
        ${TOUCH_STYLES}
      </style>
      <ha-card${this._haCardAttrs()}>
        ${title ? `<div class="header">${title}</div>` : ""}
        ${top ? this._addFormHtml("add-row top") : ""}
        <div class="list-scroll"><div class="list-region"></div></div>
        ${top ? "" : this._addFormHtml("add-row")}
      </ha-card>
    `;

    this._bindCompactAddEvents();
  }

  _renderPanelShell() {
    const title = esc(this._title());

    this.shadowRoot.innerHTML = `
      <style>
        ${this._shellStyles()}

        .panel-columns { display: flex; gap: 24px; align-items: flex-start; }
        .panel-col { flex: 1; min-width: 0; }
        :host([layout="grid"]) .panel-columns, ha-card.capped .panel-columns { flex: 1 1 auto; min-height: 0; align-items: stretch; }
        :host([layout="grid"]) .panel-col, ha-card.capped .panel-col { display: flex; flex-direction: column; min-height: 0; }

        .panel-add-row { display: flex; gap: 8px; margin-bottom: 14px; flex-shrink: 0; }
        .panel-add-row input {
          flex: 1; min-width: 0; padding: 8px 10px; border-radius: 8px;
          border: 1px solid var(--divider-color, rgba(127,127,127,.3));
          background: var(--card-background-color, transparent);
          color: var(--primary-text-color); font-size: 14px; font-family: inherit;
        }
        .panel-add-row input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        .panel-add-row button {
          flex-shrink: 0; padding: 8px 14px; border-radius: 8px; border: none;
          background: var(--primary-color); color: var(--text-primary-color, #fff);
          font-size: 14px; font-family: inherit; cursor: pointer;
        }
        .panel-add-row button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

        .panel-suggest-list { display: flex; flex-direction: column; max-height: 360px; overflow-y: auto; }
        :host([layout="grid"]) .panel-suggest-list, ha-card.capped .panel-suggest-list { flex: 1 1 auto; min-height: 0; max-height: none; }
        ${TOUCH_STYLES}
      </style>
      <ha-card${this._haCardAttrs()}>
        <div class="panel-columns">
          <div class="panel-col">
            ${title ? `<div class="header">${title}</div>` : ""}
            <div class="list-scroll"><div class="list-region"></div></div>
          </div>
          <div class="panel-col">
            ${this._addFormHtml("panel-add-row")}
            <div class="header">${t(this._hass, "suggestions_header")}</div>
            <div class="panel-suggest-list">${this._panelSuggestionsMarkup("")}</div>
          </div>
        </div>
      </ha-card>
    `;

    this._bindPanelAddEvents();
  }

  // The only part of the card that changes when items change. Keeps the
  // list's scroll position across refreshes (innerHTML swap of the CHILD,
  // the scroll container itself stays in the DOM).
  _renderListRegion() {
    const region = this.shadowRoot.querySelector(".list-region");
    if (!region) return;
    region.innerHTML = `${this._listBody()}${this._renderCompletedSection()}`;
    this._bindListEvents();
  }

  _listBody() {
    if (this._loading) return `<div class="status">${t(this._hass, "loading")}</div>`;
    if (this._error) return `<div class="status error">${t(this._hass, "error")}</div>`;
    if (this._items.length === 0) return `<div class="status">${t(this._hass, "empty")}</div>`;
    const active = this._activeItems();
    if (active.length === 0) return `<div class="status">${t(this._hass, "all_done")}</div>`;
    return this._renderList(active);
  }

  // Crossed-off items are hidden from the main list by default (this card is
  // for planning, not a shopping-history log) but never silently deleted —
  // this collapsed-by-default section is the only place a delete can happen
  // from, so an everyday checkbox tap on the main list is never destructive.
  _renderCompletedSection() {
    if (this._loading || this._error) return "";
    const completed = this._completedItems();
    if (completed.length === 0) return "";
    const expanded = this._showCompleted;
    return `
      <button class="completed-toggle" aria-expanded="${expanded}">
        <span class="chevron">${expanded ? "▾" : "▸"}</span>
        ${t(this._hass, "completed_count", { n: completed.length })}
      </button>
      ${expanded ? `
        <div class="rows completed-rows">${completed.map((item) => this._renderRow(item)).join("")}</div>
        <button class="clear-completed">${t(this._hass, "clear_completed")}</button>
      ` : ""}
    `;
  }

  _bindListEvents() {
    const region = this.shadowRoot.querySelector(".list-region");
    if (!region) return;
    region.querySelectorAll(".row input[type=checkbox]").forEach((el) => {
      el.addEventListener("change", () => {
        const item = this._items.find((i) => i.uid === el.dataset.uid);
        if (item) this._toggleItem(item);
      });
    });
    region.querySelectorAll(".row .remove").forEach((el) => {
      el.addEventListener("click", () => {
        const item = this._items.find((i) => i.uid === el.dataset.uid);
        if (item) this._removeItem(item);
      });
    });

    region.querySelector(".completed-toggle")?.addEventListener("click", () => {
      this._showCompleted = !this._showCompleted;
      this._renderListRegion();
    });
    region.querySelector(".clear-completed")?.addEventListener("click", () => {
      this._removeItems(this._completedItems());
    });
  }

  _bindCompactAddEvents() {
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
      const { item, note } = this._parseAddInput(input.value);
      if (note) this._addItemWithNote(item, note);
      else this._addItem(item);
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
      const suggestion = this._suggestions.find((s) => s.name === row.dataset.name);
      this._addItemWithNote(row.dataset.name, suggestion?.note || null);
      input.value = "";
      closeDropdown();
    });
  }

  _bindPanelAddEvents() {
    const form = this.shadowRoot.querySelector(".panel-add-row");
    if (!form) return;
    const input = form.querySelector("input");
    const list = this.shadowRoot.querySelector(".panel-suggest-list");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const { item, note } = this._parseAddInput(input.value);
      if (note) this._addItemWithNote(item, note);
      else this._addItem(item);
      input.value = "";
      this._updatePanelSuggestions("");
    });

    input.addEventListener("input", () => this._updatePanelSuggestions(input.value));

    // No focus/blur dance needed here — the list is always visible, it just
    // filters as you type. mousedown (not click) still matters: it fires
    // before the input would blur, keeping the picked value intact.
    list.addEventListener("mousedown", (e) => {
      const row = e.target.closest(".suggestion-row");
      if (!row) return;
      e.preventDefault();
      const suggestion = this._suggestions.find((s) => s.name === row.dataset.name);
      this._addItemWithNote(row.dataset.name, suggestion?.note || null);
      input.value = "";
      this._updatePanelSuggestions("");
    });
  }

  // ─── Visual editor ─────────────────────────────────────────────────────

  static getConfigElement() {
    return document.createElement("ourgroceries-shopping-card-editor");
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find((e) => e.startsWith("todo.")) || "";
    return { entity, panel: false };
  }
}

function editorSchema(hass) {
  return [
    { name: "entity", required: true, selector: { entity: { domain: "todo" } } },
    { name: "title", selector: { text: {} } },
    { name: "panel", selector: { boolean: {} } },
    {
      name: "input_position",
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "bottom", label: t(hass, "input_bottom") },
            { value: "top", label: t(hass, "input_top") },
          ],
        },
      },
    },
    { name: "max_height", selector: { text: {} } },
  ];
}

class OurGroceriesShoppingCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const event = new CustomEvent("config-changed", {
          detail: { config: ev.detail.value },
          bubbles: true,
          composed: true,
        });
        this.dispatchEvent(event);
      });
      this.appendChild(this._form);
    }

    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = editorSchema(this._hass);
    this._form.computeLabel = (schema) => t(this._hass, `editor_${schema.name}`);
  }
}

customElements.define("ourgroceries-shopping-card", OurGroceriesShoppingCard);
customElements.define("ourgroceries-shopping-card-editor", OurGroceriesShoppingCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ourgroceries-shopping-card",
  name: "OurGroceries Shopping Card",
  description: "Shopping list card for a todo entity, with category grouping and click-to-add suggestions from your OurGroceries item history",
});
