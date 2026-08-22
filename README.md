# OurGroceries Shopping Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)
[![GitHub release](https://img.shields.io/github/release/johro897/ourgroceries-shopping-card.svg)](https://github.com/johro897/ourgroceries-shopping-card/releases)

<img src="images/icon.png" width="96" alt="">

A Lovelace shopping-list card for a Home Assistant `todo.*` entity: items grouped by category, with a click-to-add suggestions dropdown sourced from your OurGroceries item history.

*(Icon only for now — a real screenshot will replace it here once this has been tested in a live dashboard.)*

---

## How it works

This card doesn't talk to OurGroceries directly. It reads and writes your list entirely through Home Assistant's standard `todo.*` services against whatever `entity:` you configure — normally an entity from the companion [ourgroceries-sync](https://github.com/johro897/ourgroceries-sync) integration, but it'll work against any `todo` entity from any source (including HA's built-in [OurGroceries integration](https://www.home-assistant.io/integrations/ourgroceries/), if you're using that instead).

Category grouping and suggestions both come from the separate, optional companion integration [ourgroceries-sync](https://github.com/johro897/ourgroceries-sync), via two of its services (`get_categories`, `get_suggestions`). Without it installed — or against a `todo.*` entity from some other source — the card still works fully: it just falls back to a flat, ungrouped list with no suggestions.

---

## Features

- Checklist-style list: checkbox + item name, click to mark done/undone
- Items grouped under a category header bar (color assigned per category name, not from OurGroceries — see "How categories work" below), when the companion integration provides category data
- Remove button per item (shown on hover)
- Add-item field with a click-to-add suggestions dropdown, sourced from your OurGroceries history — clicking a suggestion adds it immediately, no separate Add step (requires [ourgroceries-sync](https://github.com/johro897/ourgroceries-sync))
- Theme-aware styling, no external dependencies

## How categories work

Category *names* come from your OurGroceries account. Category *colors* don't — OurGroceries' API doesn't expose one, so this card assigns a color to each category by hashing its name, consistently across reloads. Items with no category are grouped under a generic "Other" bucket at the end of the list.

---

## Installation

### Via HACS

1. HACS → ⋮ → Custom repositories → add `https://github.com/johro897/ourgroceries-shopping-card`, category **Dashboard**
2. Search for **OurGroceries Shopping Card** and install
3. Add the resource if HACS doesn't do it automatically: **Settings → Dashboards → Resources**

### Manual

1. Copy `ourgroceries-shopping-card.js` to `/config/www/ourgroceries-shopping-card.js`
2. Add the resource: **Settings → Dashboards → Resources → +**
   ```yaml
   url: /local/ourgroceries-shopping-card.js
   type: module
   ```

---

## Configuration

```yaml
type: custom:ourgroceries-shopping-card
entity: todo.groceries
title: Groceries   # optional — defaults to the entity's own friendly name
```

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | **required** | A `todo.*` entity |
| `title` | string | *(entity's friendly name)* | Card title |

---

## Requirements

- Home Assistant 2024.1 or newer (needs the `todo` domain's `get_items` service with a response)
- A `todo.*` entity — typically from the companion [ourgroceries-sync](https://github.com/johro897/ourgroceries-sync) integration
- Optional, for category grouping and suggestions: [ourgroceries-sync](https://github.com/johro897/ourgroceries-sync) 1.1.0+ installed and configured

---

## Changelog

### 1.2.0
- Items now group under a category header bar when the companion integration provides category data (new `get_categories` call), falling back to a flat list otherwise
- Replaced the native `<datalist>` autocomplete with a custom dropdown: clicking a suggestion now adds it immediately, no separate Add step. Native datalist had no reliable way to detect "user clicked a suggestion" versus "user typed matching text," only a same-text heuristic
- Suggestions now show an item's note (e.g. "125g") as subtext, from `get_suggestions`' new `note` field

### 1.1.0
- Autocomplete now calls `ourgroceries_sync.get_suggestions` — the companion integration was renamed and expanded from `ourgroceries-autocomplete` to `ourgroceries-sync` (now a full `todo.*` sync integration, not just suggestions). No change needed here beyond the service domain: this card only ever talked to generic `todo.*` services, never to the companion integration's entities directly.

### 1.0.0
- Initial release
- List view with add/check/remove via standard `todo.*` services
- Add-item autocomplete sourced from `ourgroceries_autocomplete.get_suggestions`, degrades gracefully if that integration isn't installed
- English and Swedish UI

---

## License

MIT License — see [LICENSE](LICENSE)
