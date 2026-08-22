# OurGroceries Shopping Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)
[![GitHub release](https://img.shields.io/github/release/johro897/ourgroceries-shopping-card.svg)](https://github.com/johro897/ourgroceries-shopping-card/releases)

<img src="images/icon.png" width="96" alt="">

A Lovelace shopping-list card for a Home Assistant `todo.*` entity, with add-item autocomplete sourced from your OurGroceries item history.

*(Icon only for now — a real screenshot will replace it here once this has been tested in a live dashboard.)*

---

## How it works

This card doesn't talk to OurGroceries directly. It reads and writes your list entirely through Home Assistant's standard `todo.*` services against whatever `entity:` you configure — normally an entity from the companion [ourgroceries-sync](https://github.com/johro897/ourgroceries-sync) integration, but it'll work against any `todo` entity from any source (including HA's built-in [OurGroceries integration](https://www.home-assistant.io/integrations/ourgroceries/), if you're using that instead).

The autocomplete suggestions come from a separate, optional companion integration: [ourgroceries-sync](https://github.com/johro897/ourgroceries-sync). It exposes your OurGroceries "master list" (the item history OurGroceries' own app uses for suggestions) as a service this card calls. Without it installed, the card still works fully — you just won't get suggestions while typing.

---

## Features

- Checklist-style list: checkbox + item name, click to mark done/undone
- Remove button per item (shown on hover)
- Add-item field with native browser autocomplete, suggesting items from your OurGroceries history (requires [ourgroceries-sync](https://github.com/johro897/ourgroceries-sync))
- Theme-aware styling, no external dependencies

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
- Optional, for autocomplete: [ourgroceries-sync](https://github.com/johro897/ourgroceries-sync) installed and configured

---

## Changelog

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
