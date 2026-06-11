# SFMC Inspector Reloaded

> A lightweight Chrome extension for exploring Salesforce Marketing Cloud metadata without leaving your logged-in SFMC session.

![Version](https://img.shields.io/badge/version-1.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Manifest](https://img.shields.io/badge/manifest-v3-orange)

---

## Credits

This repository is a fork of the original [`TokyoYugen/sfmc-inspector`](https://github.com/TokyoYugen/sfmc-inspector) project.

Credit for the original idea, foundation, and early implementation goes to the original author. This fork builds on that work with a cleaner launcher popup, a dedicated Metadata Explorer, SQL Search, native SFMC navigation, progressive loading states, additional metadata relationships, and persistent local metadata storage.

---

## Why This Exists

Salesforce Marketing Cloud is powerful, but moving between Data Extensions, Automations, Query Activities, and Journeys can be slow when you are debugging dependencies or trying to understand how your assets connect to each other.

SFMC Inspector Reloaded sits in the browser toolbar and gives you a fast metadata layer over the SFMC UI:

- find Data Extensions quickly
- see which automations write to a DE
- see which Journeys reference a DE as an entry source
- search in all SQL Query Activities across the business unit
- jump back into the native SFMC object when you need to edit or inspect it there

It does not ask for credentials, store OAuth secrets, or send metadata to third-party services.

---

## Current Features

### Popup Launcher

- Compact popup focused on search, navigation, and metadata loading state.
- Loads DE, Automation, and Journey metadata only when the local cache is empty.
- Shows progress per metadata type with row-level progress bars and final metadata icons.
- Provides global search suggestions across loaded Data Extensions, Automations, and Journeys.
- Opens Metadata Explorer directly on the selected metadata detail when a search suggestion is chosen.
- Shows host, stack, and detected Business Unit context when available.
- Uses a shared visual language with module icons, muted blue icon treatments, and a compact footer.

### Metadata Explorer

- Dedicated full-page Metadata Explorer instead of squeezing metadata browsing into the popup.
- Three-column layout for metadata type navigation, result list, and detail view.
- Browse Data Extensions with quick search and folder path context.
- Open DE details with sendable/testable flags, dates, customer key, and path.
- Scan automations that write to a selected DE.
- Scan Journey entry sources related to a selected DE.
- Browse Automations with status, schedule, and activity details.
- Browse all Journey pages, not just the first page returned by SFMC.
- Includes shortcuts to visible companion tools.

### SQL Search

- Dedicated full-page SQL Search workspace.
- Index Query Activities and hydrate SQL text.
- Search SQL, Query Activity names, target Data Extensions, automation names, and automation usage.
- Show SQL snippets and match counts.
- Correlate Query Activities back to the automations that use them.
- Includes shortcuts to visible companion tools.

### View in SFMC

Clickable object names open the closest native SFMC screen:

- Data Extensions open through Contact Builder and then navigate the authenticated `contactsmeta` frame to the selected DE properties route using ObjectID.
- Automations open through the native Automation Studio shell route.
- Query Activities open through the native Automation Studio activity modal route.
- Journeys open through the native Journey Builder shell route with Journey ID and version.

If a stable direct object route is not available, Inspector falls back to the relevant SFMC section instead of sending you to a broken login page.

### Developer Helpers

- Global popup search across loaded DEs, Automations, and Journeys.
- Parallelized metadata loading for DEs, Automations, and Journeys.
- Local metadata cache scoped by host, stack, and Business Unit context.
- Progressive row-level loading states for DE, Automation, and Journey metadata.
- Refreshable session detection from any open SFMC tab.
- Debug logging for `pl.request.organization` to inspect Business Unit context.

---

## Authentication And Privacy

SFMC Inspector Reloaded uses the SFMC session that already exists in your browser.

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
7. Click the SFMC Inspector Reloaded toolbar icon.

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
│   ├── popup.html                # Compact launcher, global search, metadata loading state
│   ├── popup.css                 # Popup UI styles
│   └── popup.js                  # Popup controller, cache loading, search suggestions
├── metadata-explorer/
│   ├── metadata-explorer.html    # Dedicated three-column metadata browser
│   ├── metadata-explorer.css
│   └── metadata-explorer.js
├── sql-search/
│   ├── sql-search.html           # Dedicated SQL Search page
│   ├── sql-search.css
│   └── sql-search.js
├── query-editor/
│   ├── query-editor.html         # Hidden beta SQL prototyping workspace
│   ├── query-editor.css
│   └── query-editor.js
├── shared/
│   ├── feature-flags.js          # Static release gates for beta modules
│   ├── metadata-store.js         # Shared metadata cache and parallel loader
│   ├── sfmc-api.js               # Shared SFMC API wrapper
│   └── ui.css                    # Shared UI tokens and reusable components
└── assets/
    └── icons/
        ├── MetadataIcons/
        └── ModulesIcons/
```

---

## Native Navigation Notes

Marketing Cloud does not expose stable address-bar URLs for every object. Some apps are rendered inside nested iframes, and the visible URL may only show the outer shell route.

Inspector handles this per object type:

- **Data Extensions**: opens Contact Builder, searches for the authenticated `contactsmeta` iframe, and navigates that frame to `/contactsmeta/admin.html#admin/data-extension/{ObjectID}/properties/`.
- **Automations**: opens the native Automation Studio instance route.
- **Query Activities**: opens the native Automation Studio activity modal route.
- **Journeys**: opens the native Journey Builder route using Journey ID and version.

For Data Extensions, Inspector uses the actual iframe `window.location.origin` instead of guessing whether the frame is hosted on `exacttarget.com`, `marketingcloudapps.com`, or another stack-specific host.

---

## Recently Added In 1.2.0

- Refactored the popup into a compact launcher with metadata search suggestions.
- Moved metadata browsing into a dedicated three-column Metadata Explorer page.
- Added shared metadata caching and parallel loading for Data Extensions, Automations, and Journeys.
- Added row-level progress bars and final SVG metadata icons in the popup metadata index.
- Added a consistent visual system across Popup, Metadata Explorer, SQL Search, and the hidden Query Editor prototype.
- Added module icons and shared shortcut panels across the visible full-page modules.
- Added the hidden beta Query Editor code path behind a disabled feature flag.
- Added Business Unit context discovery from `pl.request.organization` with debug logging.
- Restored Data Extension native navigation by opening Contact Builder and then routing the authenticated `contactsmeta` iframe to the DE properties page.
- Hardened Data Extension ObjectID handling across lowercase and SFMC capitalized API fields.
- Bumped metadata cache version so older cached DE records are refreshed with proper ObjectID values.

## Roadmap

- Harden Contact Builder iframe navigation across more SFMC stacks.
- Add a visual Journey dependency map.
- Add a Query Editor as an alternative to Query Studio for safer SFMC SQL prototyping and execution planning.
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
