# SFMC Inspector

> The definitive developer toolkit for Salesforce Marketing Cloud Engagement.

![Version](https://img.shields.io/badge/version-1.1.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Manifest](https://img.shields.io/badge/manifest-v3-orange)

---

## Fork notice

This project is a fork of the original [`TokyoYugen/sfmc-inspector`](https://github.com/TokyoYugen/sfmc-inspector) project.

All credit for the original idea, foundation, and early implementation goes to the original author. This fork builds on that work with additional navigation, search, linting, and UI improvements for Salesforce Marketing Cloud developers.

---

## What it does

SFMC Inspector runs inside your browser while you're logged into Salesforce Marketing Cloud. It reads your existing session — no OAuth setup, no credentials to enter — and gives you superpowers the native UI doesn't have.

### Features (v1.1.3)

| Feature | Description |
|---|---|
| **Session Detection** | Automatically detects your SFMC session from any open SFMC tab |
| **Data Extension Explorer** | Browse all DEs with quick search, automation write mapping, and Journey entry-source references |
| **Automation Monitor** | Browse automations with status, schedule, and inline SQL preview |
| **Full Journey Loading** | Loads all Journey Builder pages instead of stopping at the first page of results |
| **SQL Search & Query Index** | Index Query Activities, hydrate SQL text, correlate automation usage, and search SQL, target DEs, query names, and automation metadata |
| **SQL & AMPScript Linters** | 10-rule static analysis for SFMC Query Activity SQL and AMPScript V1 blocks |
| **Global Search** | ⌘K search across DEs, Automations, Journeys simultaneously |
| **View in SFMC** | Click native object names to open Data Extensions, Automations, Query Activities, and Journeys in the native SFMC UI when a route is available |
| **Progressive Loading Counters** | Shows live load progress for Data Extensions, Automations, and Journeys while metadata is being fetched |
| **Refreshed Popup UI** | Updated light Salesforce-inspired layout, detail panels, toolbar controls, loading states, and native-open affordances |

### Native navigation notes

SFMC apps are often rendered inside nested iframes, so not every object has a stable URL visible in the browser address bar. Inspector handles this with object-specific navigation:

- Automations, Query Activities, and Journeys use Marketing Cloud shell routes when a stable route is available.
- Data Extensions use a Contact Builder-specific flow: Inspector focuses the existing SFMC tab, opens Contact Builder, injects into available frames, detects the authenticated `contactsmeta` iframe, and navigates that iframe to the selected Data Extension properties route.

If a direct object route cannot be built, Inspector opens the closest native SFMC section instead of sending you to a broken login page.

---

## How authentication works

SFMC Inspector uses the **same session your browser already has** when you're logged into SFMC. It executes authenticated API calls directly inside your active SFMC tab using Chrome's scripting API — the browser's existing session is used 
automatically, without reading or storing cookies.

- ✅ No OAuth setup required
- ✅ No credentials stored
- ✅ No data sent to third parties
- ✅ Respects your SFMC permissions — you can only see what your user can access
- ✅ Detects session expiry and prompts you to refresh

---

## Installation (development)

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `sfmc-inspector/` folder
6. Open Salesforce Marketing Cloud in a tab
7. Click the SFMC Inspector icon in your toolbar

---

## Project structure

```
sfmc-inspector/
├── manifest.json                 # Manifest V3
├── background/
│   └── service-worker.js         # Session management, API proxy
├── content/
│   └── detector.js               # SFMC page detector, token extractor
├── panel/
│   ├── popup.html                # Extension popup UI
│   ├── popup.css                 # Popup styles and native navigation affordances
│   └── popup.js                  # UI controller
├── sql-search/
│   ├── sql-search.html           # Dedicated SQL Search workspace
│   ├── sql-search.css            # SQL Search styles
│   └── sql-search.js             # Query Activity indexing and SQL search UI
├── shared/
│   ├── sfmc-api.js               # REST API wrapper
│   ├── sql-linter.js             # SQL static analysis (10 rules)
│   └── ampscript-linter.js       # AMPScript static analysis (10 rules)
└── assets/
    └── icons/                    # Extension icons (to be added)
```

---

## Linter rules

### SQL (Query Activities)

| Rule | Severity | Description |
|---|---|---|
| SQL001 | 🔴 Error | SELECT * used |
| SQL002 | 🟡 Warning | Missing NOLOCK on data views |
| SQL003 | 🔴 Error | NULL comparison with = or != |
| SQL004 | 🟡 Warning | No WHERE clause on high-volume data view |
| SQL005 | 🟡 Warning | Implicit type coercion in JOIN |
| SQL006 | 🔵 Info | DISTINCT on high-volume table |
| SQL007 | 🟡 Warning | Subquery in WHERE instead of JOIN |
| SQL009 | 🔵 Info | TOP without ORDER BY |
| SQL010 | 🟡 Warning | GETDATE() without timezone context |

### AMPScript (Emails / CloudPages / Templates)

| Rule | Severity | Description |
|---|---|---|
| AMP001 | 🔴 Error | Variable used without VAR declaration |
| AMP002 | 🔴 Error | IF block without ENDIF |
| AMP003 | 🔴 Error | FOR block without NEXT |
| AMP004 | 🟡 Warning | Output without EncodeValue() |
| AMP005 | 🟡 Warning | Hardcoded email address or ClientID |
| AMP006 | 🔴 Error | LookupRows without null check |
| AMP007 | 🟡 Warning | Lowercase AMPScript keywords |
| AMP008 | 🔵 Info | TreatAsContent() usage detected |
| AMP009 | 🟡 Warning | Data write without error handling |
| AMP010 | 🔵 Info | V2 syntax detected |

---

## Completed

- [x] Icons (v1.1.2)
- [x] Dedicated SQL Search workspace
- [x] Clickable native object navigation
- [x] Full Journey pagination
- [x] Progressive loading counters for DEs, Automations, and Journeys
- [x] Chrome Web Store listing (submitted)

## Roadmap

- [ ] Harden Contact Builder iframe navigation across more SFMC stacks
- [ ] Journey dependency map (visual tree)
- [ ] DE Health Dashboard (NULL columns, orphaned DEs)
- [ ] Broken link detector for emails
- [ ] Export metadata to JSON/CSV
- [ ] Firefox support

---

## Contributing

PRs welcome. Before starting work on a feature, open an issue to discuss the approach.

**Code standards:**
- Vanilla JS only (no frameworks in content/background scripts)
- No `let`/`const`/arrow functions in content scripts (keep IE11-era compat for SFMC's older iframe contexts)
- All SFMC API calls go through `sfmc-api.js`

---

## License

MIT — free for everyone, forever.
