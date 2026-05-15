# SFMC Inspector

> A lightweight Chrome extension for exploring Salesforce Marketing Cloud metadata without leaving your logged-in SFMC session.

![Version](https://img.shields.io/badge/version-1.1.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Manifest](https://img.shields.io/badge/manifest-v3-orange)

---

## Credits

This repository is a fork of the original [`TokyoYugen/sfmc-inspector`](https://github.com/TokyoYugen/sfmc-inspector) project.

Credit for the original idea, foundation, and early implementation belongs to the original author. This fork keeps that foundation and extends it with a more complete popup experience, SQL search, native SFMC navigation, progressive loading states, and additional metadata relationships.

---

## Why This Exists

Salesforce Marketing Cloud is powerful, but moving between Data Extensions, Automations, Query Activities, and Journeys can be slow when you are debugging dependencies or trying to understand how an account is wired together.

SFMC Inspector sits in the browser toolbar and gives you a fast metadata layer over the SFMC UI:

- find Data Extensions quickly
- see which automations write to a DE
- see which Journeys reference a DE as an entry source
- search Query Activity SQL across the business unit
- jump back into the native SFMC object when you need to edit or inspect it there
- lint SQL and AMPScript snippets while you work

It does not ask for credentials, store OAuth secrets, or send metadata to third-party services.

---

## Current Features

### Metadata Explorer

- Browse Data Extensions with quick search and folder path context.
- Open DE details with sendable/testable flags, dates, customer key, and path.
- Scan automations that write to a selected DE.
- Scan Journey entry sources related to a selected DE.
- Browse Automations with status, schedule, and activity details.
- Browse all Journey pages, not just the first page returned by SFMC.

### SQL Search

- Dedicated full-page SQL Search workspace.
- Index Query Activities and hydrate SQL text.
- Search SQL, Query Activity names, target Data Extensions, automation names, and automation usage.
- Show SQL snippets and match counts.
- Correlate Query Activities back to the automations that use them.

### View in SFMC

Clickable object names open the closest native SFMC screen:

- Data Extensions open through Contact Builder and then attempt to navigate the authenticated `contactsmeta` frame to the selected DE.
- Automations open through the native Automation Studio shell route.
- Query Activities open through the native Automation Studio activity modal route.
- Journeys open through the native Journey Builder shell route with Journey ID and version.

If a stable direct object route is not available, Inspector falls back to the relevant SFMC section instead of sending you to a broken login page.

### Developer Helpers

- Global popup search across loaded DEs, Automations, and Journeys.
- Progressive loading counters for DE, Automation, and Journey metadata.
- SQL linter for common SFMC Query Activity issues.
- AMPScript linter for common V1-style AMPScript issues.
- Refreshable session detection from any open SFMC tab.

---

## Authentication And Privacy

SFMC Inspector uses the SFMC session that already exists in your browser.

The extension detects an open Salesforce Marketing Cloud tab, then runs authenticated SFMC API calls from that tab context through Chrome extension APIs. This means:

- no OAuth app setup
- no password prompt
- no credential storage
- no external backend
- no third-party telemetry
- SFMC permissions are respected because all data comes from your current user session

The extension stores only temporary session context and local UI/index cache in browser extension storage.

---

## Installation For Development

1. Clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the inner `sfmc-inspector/` extension folder.
6. Open Salesforce Marketing Cloud in another tab.
7. Click the SFMC Inspector toolbar icon.

---

## Project Layout

```text
sfmc-inspector/
├── manifest.json
├── background/
│   └── service-worker.js         # Session detection, injected API proxy, native navigation
├── content/
│   └── detector.js               # SFMC page detector and SSO/JWT context probe
├── panel/
│   ├── popup.html                # Popup shell
│   ├── popup.css                 # Popup UI styles
│   └── popup.js                  # Popup controller, metadata views, relationships
├── sql-search/
│   ├── sql-search.html           # Dedicated SQL Search page
│   ├── sql-search.css
│   └── sql-search.js
├── shared/
│   ├── sfmc-api.js               # Shared SFMC API wrapper
│   ├── sql-linter.js
│   └── ampscript-linter.js
└── assets/
    └── icons/
```

---

## Native Navigation Notes

Marketing Cloud does not expose stable address-bar URLs for every object. Some apps are rendered inside nested iframes, and the visible URL may only show the outer shell route.

Inspector handles this per object type:

- **Data Extensions**: opens Contact Builder, searches for the authenticated `contactsmeta` iframe, and navigates that frame to the DE properties route using ObjectID.
- **Automations**: opens the native Automation Studio instance route.
- **Query Activities**: opens the native Automation Studio activity modal route.
- **Journeys**: opens the native Journey Builder route using Journey ID and version.

Contact Builder iframe navigation can vary across SFMC stacks, so this remains the most fragile native navigation path.

---

## Linter Coverage

### SQL

| Rule | Severity | Description |
|---|---|---|
| SQL001 | Error | `SELECT *` used |
| SQL002 | Warning | Missing `NOLOCK` on data views |
| SQL003 | Error | `NULL` comparison with `=` or `!=` |
| SQL004 | Warning | No `WHERE` clause on high-volume data view |
| SQL005 | Warning | Possible implicit type coercion in join |
| SQL006 | Info | `DISTINCT` on high-volume table |
| SQL007 | Warning | Subquery in `WHERE` instead of join |
| SQL009 | Info | `TOP` without `ORDER BY` |
| SQL010 | Warning | `GETDATE()` without timezone context |

### AMPScript

| Rule | Severity | Description |
|---|---|---|
| AMP001 | Error | Variable used without `VAR` declaration |
| AMP002 | Error | `IF` block without `ENDIF` |
| AMP003 | Error | `FOR` block without `NEXT` |
| AMP004 | Warning | Output without `EncodeValue()` |
| AMP005 | Warning | Hardcoded email address or ClientID |
| AMP006 | Error | `LookupRows` without null check |
| AMP007 | Warning | Lowercase AMPScript keywords |
| AMP008 | Info | `TreatAsContent()` usage detected |
| AMP009 | Warning | Data write without error handling |
| AMP010 | Info | V2 syntax detected |

---

## Recently Added

- Native “View in SFMC” links for DEs, Automations, Query Activities, and Journeys.
- Dedicated SQL Search workspace.
- Query Activity indexing with automation usage mapping.
- Full Journey pagination.
- Progressive metadata loading counters.
- Refreshed light popup UI.
- Extension icons.

## Roadmap

- Harden Contact Builder iframe navigation across more SFMC stacks.
- Add a visual Journey dependency map.
- Add a DE health dashboard for null-heavy fields, stale objects, and orphaned DEs.
- Add broken-link detection for email and CloudPage assets.
- Export metadata and relationship maps to JSON/CSV.
- Explore Firefox support.

---

## Contributing

Pull requests are welcome. For larger changes, open an issue first so the approach can be discussed.

Code standards:

- Vanilla JavaScript only for extension code.
- No frameworks in content or background scripts.
- No `let`, `const`, or arrow functions in content scripts, to stay friendly with older SFMC iframe contexts.
- Shared SFMC API calls should go through `shared/sfmc-api.js`.
- Keep native navigation fallbacks conservative; SFMC shell and iframe routes can vary by stack.

---

## License

MIT.
