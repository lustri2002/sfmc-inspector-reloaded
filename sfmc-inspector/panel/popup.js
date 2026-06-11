/**
 * SFMC Inspector — popup.js
 * UI controller: session management, tab routing, data loading, linter.
 */

(function () {
  "use strict";

  // ─── State ───────────────────────────────────────────────────────────────────

  var state = {
    session:      null,
    activeTab:    "de",
    linterMode:   "sql",
    de: {
      items:     [],
      loaded:    false,
      loading:   false,
      filtered:  []
    },
    automations: {
      items:     [],
      loaded:    false,
      loading:   false,
      filtered:  []
    },
    queries: {
      items:     [],
      loaded:    false,
      scanning:  false,
      scannedAt: null,
      total:     null
    },
    journeys: {
      items:     [],
      loaded:    false,
      loading:   false,
      filtered:  []
    },
    // Cached full automation list for DE→Automation mapping
    allAutomations: null,
    relations: {
      automationMatchesByDe: {},
      journeyMatchesByDe:    {},
      automationDetailsById: {},
      automationMatchesByQueryId: {},
      querySqlById:          {},
      eventDefinitions:      null,
      journeysRaw:           null
    }
  };

  var POPUP_CACHE_KEY     = "sfmcInspectorPopupCache";
  var POPUP_CACHE_VERSION = 4;

  if (chrome.storage && chrome.storage.local && chrome.storage.local.setAccessLevel) {
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }, function () {
      if (chrome.runtime.lastError) {
        console.warn("[SFMC Inspector Popup] Could not restrict local storage access:", chrome.runtime.lastError.message);
      }
    });
  }

  // ─── DOM refs ────────────────────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    sessionBadge:   $("session-badge"),
    badgeDot:       document.querySelector(".badge-dot"),
    badgeLabel:     document.querySelector(".badge-label"),
    sessionBar:     $("session-bar"),
    sessionEnv:     $("session-env-label"),
    sessionStack:   $("session-stack-label"),
    noSession:      $("no-session-view"),
    mainView:       $("main-view"),
    btnRefresh:     $("btn-refresh"),
    globalSearch:   $("global-search"),

    // DE tab
    deToolbar:      $("de-toolbar"),
    deCount:        $("de-count"),
    btnLoadDe:      $("btn-load-de"),
    deLoading:      $("de-loading"),
    deList:         $("de-list"),
    deDetail:       $("de-detail"),
    deDetailContent: $("de-detail-content"),
    btnDeBack:      $("btn-de-back"),

    // Automations tab
    autoToolbar:    $("auto-toolbar"),
    autoCount:      $("auto-count"),
    btnLoadAuto:    $("btn-load-auto"),
    autoLoading:    $("auto-loading"),
    autoList:       $("auto-list"),
    autoDetail:     $("auto-detail"),
    autoDetailContent: $("auto-detail-content"),
    btnAutoBack:    $("btn-auto-back"),

    // Query Search tab
    queryCount:      $("query-count"),
    btnOpenSqlSearch: $("btn-open-sql-search"),
    btnOpenQueryEditor: $("btn-open-query-editor"),
    btnOpenSqlSearchLarge: $("btn-open-sql-search-large"),
    btnScanQueries:  $("btn-scan-queries"),
    btnClearQueryIndex: $("btn-clear-query-index"),
    queryLoading:    $("query-loading"),
    queryLoadingLabel: $("query-loading-label"),
    querySearchInput: $("query-search-input"),
    queryList:       $("query-list"),

    // Journeys tab
    journeyCount:   $("journey-count"),
    btnLoadJourneys: $("btn-load-journeys"),
    journeyLoading: $("journey-loading"),
    journeyList:    $("journey-list"),

    // Linter
    linterInput:    $("linter-input"),
    btnLint:        $("btn-lint"),
    btnLintClear:   $("btn-lint-clear"),
    linterResults:  $("linter-results")
  };

  // ─── Utilities ───────────────────────────────────────────────────────────────

  function escHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(date) {
    if (!date) return "—";
    try {
      return new Date(date).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric"
      });
    } catch (e) { return date; }
  }

  function formatPathValue(value) {
    if (!value) return "";
    return String(value).replace(/\\/g, " / ");
  }

  function getDataExtensionPath(de) {
    return formatPathValue(de.categoryFullPath);
  }

  function statusTag(status) {
    if (!status) return "";
    var s = String(status).toLowerCase();
    var cls = s === "active" || s === "running" || s === "published"
      ? "green" : s === "paused" || s === "draft"
      ? "yellow" : s === "error" || s === "stopped"
      ? "red" : "muted";
    return '<span class="tag tag--' + cls + '">' + escHtml(status) + "</span>";
  }

  function highlight(text, query) {
    if (!query || !text) return escHtml(text);
    var re = new RegExp("(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    return escHtml(text).replace(re, '<span class="hl">$1</span>');
  }

  function getSfmcHost() {
    return state.session && state.session.hostname ? String(state.session.hostname).replace(/\/+$/, "") : "";
  }

  function buildSfmcUrl(path) {
    var host = getSfmcHost();
    if (!host) return "";
    return "https://" + host + path;
  }

  function encodePathPart(value) {
    return encodeURIComponent(String(value || ""));
  }

  function getNativeObjectUrl(type, item) {
    item = item || {};

    if (type === "dataExtension") {
      return buildSfmcUrl("/cloud/#app/Contact%20Builder");
    }

    if (type === "automation") {
      var automationId = item.id || item.automationId || "";
      if (automationId) {
        return buildSfmcUrl("/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23Instance/" + encodePathPart(automationId) + "/activity");
      }
      return buildSfmcUrl("/cloud/#app/Automation%20Studio/AutomationStudioFuel3/");
    }

    if (type === "query") {
      var queryId = item.id || item.activityObjectId || item.queryActivityId || item.queryDefinitionId || "";
      if (queryId) {
        return buildSfmcUrl("/cloud/#app/Automation%20Studio/AutomationStudioFuel3/%23ActivityModal/300/" + encodePathPart(queryId));
      }
      return buildSfmcUrl("/cloud/#app/Automation%20Studio/AutomationStudioFuel3/");
    }

    if (type === "journey") {
      var url = item.url || item.nativeUrl || item.link || "";
      var journeyId = item.id || item.interactionId || item.definitionId || "";
      var journeyVersion = item.version || item.versionNumber || 1;
      if (/^https?:\/\//i.test(url)) return url;
      if (url && url.charAt(0) === "/") return buildSfmcUrl(url);
      if (journeyId) {
        return buildSfmcUrl("/cloud/#app/Journey%20Builder/%23" + encodePathPart(journeyId) + "/" + encodePathPart(journeyVersion));
      }
      return buildSfmcUrl("/cloud/#app/Journey%20Builder/");
    }

    return "";
  }

  function nativeOpenIconHtml() {
    return '<span class="native-open-icon" aria-hidden="true">↗</span>';
  }

  function nativeLinkAttrs(type, item) {
    item = item || {};
    var id = item.id || item.objectId || item.dataExtensionId ||
      item.automationId || item.activityObjectId || item.queryActivityId ||
      item.queryDefinitionId || item.interactionId || item.definitionId || "";
    var version = item.version || item.versionNumber || "";

    return ' data-native-type="' + escHtml(type || "") + '"' +
      ' data-native-id="' + escHtml(id) + '"' +
      ' data-native-version="' + escHtml(version) + '"';
  }

  function nativeLinkHtml(labelHtml, type, item, className) {
    var url = getNativeObjectUrl(type, item);
    var cls = className || "";
    if (!url) {
      return '<span class="' + cls + ' native-open-unavailable" title="Open in SFMC non disponibile per questo oggetto">' +
        labelHtml + nativeOpenIconHtml() +
      "</span>";
    }
    return '<a class="' + cls + ' native-open-link" href="' + escHtml(url) + '" title="View in SFMC"' + nativeLinkAttrs(type, item) + ">" +
      labelHtml + nativeOpenIconHtml() +
    "</a>";
  }

  function nativeTitleHtml(label, type, item) {
    return nativeLinkHtml(escHtml(label), type, item, "detail-title detail-title-link");
  }

  function emptyRelations() {
    return {
      automationMatchesByDe: {},
      journeyMatchesByDe:    {},
      automationDetailsById: {},
      automationMatchesByQueryId: {},
      querySqlById:          {},
      eventDefinitions:      null,
      journeysRaw:           null
    };
  }

  function getSessionCacheKey(session) {
    if (!session || !session.isValid) return "";
    return [
      session.hostname || "",
      session.businessUnitId || "",
      session.stackKey || ""
    ].join("|");
  }

  function readPopupCache() {
    return new Promise(function (resolve) {
      if (!chrome.storage || !chrome.storage.local) {
        resolve(null);
        return;
      }
      chrome.storage.local.get(POPUP_CACHE_KEY, function (result) {
        resolve(result && result[POPUP_CACHE_KEY] ? result[POPUP_CACHE_KEY] : null);
      });
    });
  }

  function getPersistableRelations() {
    return {
      automationMatchesByDe: state.relations.automationMatchesByDe,
      journeyMatchesByDe:    state.relations.journeyMatchesByDe,
      automationMatchesByQueryId: state.relations.automationMatchesByQueryId,
      // Full automation details can become large; keep them in popup memory only.
      automationDetailsById: {},
      // Query Search stores SQL inside its own index; avoid duplicating large SQL blobs.
      querySqlById:          state.queries.loaded ? {} : state.relations.querySqlById,
      eventDefinitions:      state.relations.eventDefinitions,
      journeysRaw:           state.relations.journeysRaw
    };
  }

  function savePopupCache() {
    if (!state.session || !state.session.isValid || !chrome.storage || !chrome.storage.local) return;

    var payload = {};
    payload[POPUP_CACHE_KEY] = {
      version:        POPUP_CACHE_VERSION,
      sessionKey:     getSessionCacheKey(state.session),
      updatedAt:      Date.now(),
      de:             { items: state.de.items, loaded: state.de.loaded }
    };

    chrome.storage.local.set(payload, function () {
      if (chrome.runtime.lastError) {
        console.warn("[SFMC Inspector Popup] Could not save local cache:", chrome.runtime.lastError.message);
      }
    });
  }

  function clearPopupCache() {
    if (!chrome.storage || !chrome.storage.local) return Promise.resolve();
    return new Promise(function (resolve) {
      chrome.storage.local.remove(POPUP_CACHE_KEY, resolve);
    });
  }

  function setLoadedButtonLabels() {
    els.btnLoadDe.textContent       = state.de.loading ? "Loading" : state.de.loaded ? "Reload" : "Load";
    els.btnLoadAuto.textContent     = state.automations.loading ? "Loading" : state.automations.loaded ? "Reload" : "Load";
    els.btnScanQueries.textContent  = state.queries.scanning ? "Scanning" : state.queries.loaded ? "Rescan" : "Scan";
    els.btnLoadJourneys.textContent = state.journeys.loading ? "Loading" : state.journeys.loaded ? "Reload" : "Load";
  }

  function resetLoadedData() {
    state.de.items = [];
    state.de.loaded = false;
    state.de.loading = false;
    state.automations.items = [];
    state.automations.loaded = false;
    state.automations.loading = false;
    state.queries.items = [];
    state.queries.loaded = false;
    state.queries.scanning = false;
    state.queries.scannedAt = null;
    state.queries.total = null;
    state.journeys.items = [];
    state.journeys.loaded = false;
    state.journeys.loading = false;
    state.allAutomations = null;
    state.relations = emptyRelations();

    els.deList.innerHTML = "";
    els.autoList.innerHTML = "";
    els.queryList.innerHTML = '<div class="no-results">Query metadata will index automatically when the SFMC session is ready.</div>';
    els.journeyList.innerHTML = "";
    els.deCount.textContent = "—";
    els.autoCount.textContent = "—";
    els.queryCount.textContent = "—";
    els.journeyCount.textContent = "—";
    els.querySearchInput.value = "";
    els.querySearchInput.disabled = true;
    els.queryLoading.classList.add("hidden");
    els.deDetail.classList.add("hidden");
    els.autoDetail.classList.add("hidden");
    els.deList.classList.remove("hidden");
    els.autoList.classList.remove("hidden");
    els.deToolbar.classList.remove("hidden");
    els.autoToolbar.classList.remove("hidden");
    setLoadedButtonLabels();
  }

  function restoreCachedState(session) {
    return readPopupCache().then(function (cache) {
      if (!cache ||
          cache.version !== POPUP_CACHE_VERSION ||
          cache.sessionKey !== getSessionCacheKey(session)) {
        setLoadedButtonLabels();
        return;
      }

      if (cache.de && cache.de.loaded) {
        state.de.items = Array.isArray(cache.de.items) ? cache.de.items : [];
        state.de.loaded = true;
        els.deCount.textContent = state.de.items.length + " DE" + (state.de.items.length !== 1 ? "s" : "");
        renderDeList(els.globalSearch.value.trim());
      }
      setLoadedButtonLabels();
    });
  }

  // ─── Session ─────────────────────────────────────────────────────────────────

  function preloadAllMetadata() {
    if (!state.session || !state.session.isValid || state.de.loaded) return;
    loadDataExtensions();
  }

  function updateSessionUI(session) {
    state.session = session;

    if (session && session.isValid && session.hasToken) {
      // Connected
      els.sessionBadge.className  = "badge badge--connected";
      els.badgeLabel.textContent  = "Connected";
      els.sessionBar.classList.remove("hidden");
      els.sessionEnv.textContent  = session.hostname || session.subdomain || "SFMC";
      els.sessionStack.textContent = session.stackKey || "—";
      els.noSession.classList.add("hidden");
      els.mainView.classList.remove("hidden");
      restoreCachedState(session).then(preloadAllMetadata);
    } else {
      // Not detected
      els.sessionBadge.className  = "badge badge--error";
      els.badgeLabel.textContent  = "No session";
      els.sessionBar.classList.add("hidden");
      els.noSession.classList.remove("hidden");
      els.mainView.classList.add("hidden");
      resetLoadedData();
    }
  }

  function loadSession() {
    els.sessionBadge.className = "badge badge--detecting";
    els.badgeLabel.textContent = "Detecting...";

    // First check if SW already has a valid session
    SfmcApi.getSession().then(function(s) {
      if (s && s.isValid) { updateSessionUI(s); return; }

      // Find SFMC tab to get hostname, then let SW do the SSO probe
      chrome.tabs.query({}, function(allTabs) {
        var sfmcTab = null;
        for (var i = 0; i < allTabs.length; i++) {
          var u = allTabs[i].url || "";
          if (u.includes("exacttarget.com") || u.includes("marketingcloud.com")) {
            sfmcTab = allTabs[i]; break;
          }
        }
        if (!sfmcTab) { updateSessionUI(null); return; }

        // Extract hostname from tab URL
        var hostname = sfmcTab.url.match(/https?:\/\/([^\/]+)/);
        if (!hostname) { updateSessionUI(null); return; }
        hostname = hostname[1];

        console.log("[SFMC Inspector Popup] Found SFMC tab:", hostname);

        // Ask service worker to detect session using cookies (no CORS)
        chrome.runtime.sendMessage({ type: "DETECT_SESSION", hostname: hostname }, function(resp) {
          if (chrome.runtime.lastError) {
            console.log("[SFMC Inspector Popup] SW error:", chrome.runtime.lastError.message);
            updateSessionUI(null); return;
          }
          console.log("[SFMC Inspector Popup] DETECT_SESSION response:", JSON.stringify(resp));
          if (resp && resp.ok && resp.session) updateSessionUI(resp.session);
          else updateSessionUI(null);
        });
      });
    });
  }

  // ─── Tab Navigation ───────────────────────────────────────────────────────────

  function openSqlSearchTab() {
    chrome.tabs.create({
      url: chrome.runtime.getURL("sql-search/sql-search.html")
    });
  }

  function openQueryEditorTab() {
    chrome.tabs.create({
      url: chrome.runtime.getURL("query-editor/query-editor.html")
    });
  }

  function openInSfmcTab(url) {
    var host = getSfmcHost();
    if (!host || !url) {
      window.alert("Open in SFMC non disponibile per questo oggetto.");
      return;
    }

    chrome.tabs.query({}, function (tabs) {
      var sfmcTab = tabs.find(function (tab) {
        return tab.url && tab.url.indexOf(host) !== -1;
      });

      if (!sfmcTab) {
        window.alert("Tieni aperta una tab di Salesforce Marketing Cloud, poi riprova.");
        return;
      }

      chrome.tabs.update(sfmcTab.id, { url: url, active: true }, function () {
        if (chrome.runtime.lastError) {
          window.alert("Non riesco ad aprire SFMC: " + chrome.runtime.lastError.message);
          return;
        }

        if (sfmcTab.windowId != null && chrome.windows && chrome.windows.update) {
          chrome.windows.update(sfmcTab.windowId, { focused: true });
        }
      });
    });
  }

  document.addEventListener("click", function (evt) {
    var link = evt.target.closest && evt.target.closest(".native-open-link");
    if (!link) return;

    evt.preventDefault();
    evt.stopPropagation();

    var url = link.getAttribute("href");
    var nativeType = link.dataset.nativeType || "";
    var nativeId = link.dataset.nativeId || "";
    var nativeVersion = link.dataset.nativeVersion || "";
    if (!url) {
      window.alert("Open in SFMC non disponibile per questo oggetto.");
      return;
    }

    if (nativeType && nativeId) {
      chrome.runtime.sendMessage({
        type: "OPEN_NATIVE_OBJECT",
        payload: {
          objectType: nativeType,
          objectId: nativeId,
          version: nativeVersion,
          fallbackUrl: url
        }
      }, function (resp) {
        if (chrome.runtime.lastError) return;
        if (resp && resp.ok) return;
        if (resp && resp.error) {
          window.alert(resp.error);
        }
      });
      return;
    }

    openInSfmcTab(url);
  });

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.id === "tab-" + tabId);
    });
    loadTabMetadata(tabId);
  }

  function loadTabMetadata(tabId) {
    if (!state.session || !state.session.isValid) return;

    if (tabId === "de" && !state.de.loaded && !state.de.loading) {
      loadDataExtensions();
    } else if (tabId === "automations" && !state.automations.loaded && !state.automations.loading) {
      loadAutomations();
    } else if (tabId === "journeys" && !state.journeys.loaded && !state.journeys.loading) {
      loadJourneys();
    }
  }

  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.dataset.tab === "queries") {
        openSqlSearchTab();
        return;
      }
      switchTab(btn.dataset.tab);
    });
  });

  // ─── Global Search ────────────────────────────────────────────────────────────

  els.globalSearch.addEventListener("input", function () {
    var q = els.globalSearch.value.trim().toLowerCase();
    renderDeList(q);
    renderAutoList(q);
    renderJourneyList(q);
  });

  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      els.globalSearch.focus();
    }
  });

  // ─── DATA EXTENSIONS ─────────────────────────────────────────────────────────

  function renderDeList(query) {
    var q = (query || "").toLowerCase();
    var items = state.de.items.filter(function (de) {
      if (!q) return true;
      return (de.name && de.name.toLowerCase().includes(q)) ||
             (de.customerKey && de.customerKey.toLowerCase().includes(q));
    });

    if (!state.de.loaded) {
      els.deList.innerHTML = "";
      return;
    }

    if (items.length === 0) {
      els.deList.innerHTML = '<div class="no-results">No Data Extensions found.</div>';
      return;
    }

    els.deCount.textContent = items.length + " DE" + (items.length !== 1 ? "s" : "");
    els.deList.innerHTML = items.map(function (de) {
      var rowCount = de.rowCount != null
        ? '<span class="tag tag--muted">' + de.rowCount.toLocaleString() + " rows</span>"
        : "";
      return '<div class="list-item" data-key="' + escHtml(de.customerKey) + '">' +
        '<div class="list-item-main">' +
          '<div class="list-item-name">' + highlight(de.name, q) + "</div>" +
          '<div class="list-item-sub">' + highlight(de.customerKey, q) + "</div>" +
        "</div>" +
        '<div class="list-item-badges">' + rowCount + "</div>" +
      "</div>";
    }).join("");

    // Click → detail
    els.deList.querySelectorAll(".list-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var key = el.dataset.key;
        var de  = state.de.items.find(function (d) { return d.customerKey === key; });
        if (de) showDeDetail(de);
      });
    });
  }

  function loadDataExtensions() {
    if (!state.session || !state.session.isValid || state.de.loading) return;
    state.de.loading = true;
    els.deLoading.classList.remove("hidden");
    els.deList.innerHTML = "";
    els.deCount.textContent = "Loading…";
    setLoadedButtonLabels();

    SfmcApi.getDataExtensions(function (done, total, uniqueCount) {
      els.deCount.textContent = done + " / " + total + " prefixes" +
        (uniqueCount ? " · " + uniqueCount + " DEs" : "");
    }).then(function (data) {
      state.de.loading = false;
      els.deLoading.classList.add("hidden");
      var raw = data.items || [];
      if (!Array.isArray(raw)) raw = [];
      var items = raw.map(function (de) {
        return {
          id:          de.objectId || de.dataExtensionId || de.id || "",
          name:        de.name || de.Name || "—",
          customerKey: de.customerKey || de.CustomerKey || de.key || de.externalKey || "",
          rowCount:    de.rowCount != null ? de.rowCount : null,
          isSendable:  de.isSendable || de.IsSendable || false,
          isTestable:  de.isTestable || de.IsTestable || false,
          createdDate: de.createdDate || de.CreatedDate || null,
          modifiedDate: de.modifiedDate || de.ModifiedDate || null,
          categoryId:  de.categoryId || de.CategoryID || null,
          path:        getDataExtensionPath(de)
        };
      });
      state.de.items  = items;
      state.de.loaded = true;
      els.deCount.textContent = items.length + " DE" + (items.length !== 1 ? "s" : "");
      setLoadedButtonLabels();
      savePopupCache();
      if (items.length === 0) {
        els.deList.innerHTML = '<div class="no-results">No Data Extensions found in this Business Unit.</div>';
        return;
      }
      renderDeList(els.globalSearch.value.trim());
    }).catch(function (err) {
      state.de.loading = false;
      els.deLoading.classList.add("hidden");
      setLoadedButtonLabels();
      els.deList.innerHTML = '<div class="no-results" style="color:var(--red)">' + escHtml(err.message) + "</div>";
    });
  }

  function showDeDetail(de) {
    els.deList.classList.add("hidden");
    els.deToolbar.classList.add("hidden");
    els.deDetail.classList.remove("hidden");

    // Render basic info immediately
    els.deDetailContent.innerHTML =
      nativeTitleHtml(de.name, "dataExtension", de) +
      '<div class="detail-key">' + escHtml(de.customerKey) + "</div>" +
      '<div class="detail-section">' +
        '<div class="detail-section-title">Path</div>' +
        pathRow(de.path || "—") +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="detail-section-title">Properties</div>' +
        detailRow("Sendable",  de.isSendable ? "Yes" : "No") +
        detailRow("Testable",  de.isTestable  ? "Yes" : "No") +
        detailRow("Created",   fmt(de.createdDate)) +
        detailRow("Modified",  fmt(de.modifiedDate)) +
      "</div>" +
      '<div id="de-automations-section">' +
        '<div class="detail-section">' +
          '<div class="detail-section-title">Automations writing to this DE</div>' +
          '<div class="loader-wrap"><div class="spinner"></div><span>Scanning automations…</span></div>' +
        "</div>" +
      "</div>" +
      '<div id="de-journeys-section">' +
        '<div class="detail-section">' +
          '<div class="detail-section-title">Journey connections</div>' +
          '<div class="loader-wrap"><div class="spinner"></div><span>Checking journeys…</span></div>' +
        "</div>" +
      "</div>";

    // Async: find automations that write to this DE
    findAutomationsForDe(de.customerKey, de.name).then(function (matches) {
      var sec = $("de-automations-section");
      if (!sec) return;
      if (matches.length === 0) {
        sec.innerHTML =
          '<div class="detail-section">' +
            '<div class="detail-section-title">Automations writing to this DE</div>' +
            '<div class="no-results">No automations found targeting this DE.</div>' +
          "</div>";
      } else {
        sec.innerHTML =
          '<div class="detail-section">' +
            '<div class="detail-section-title">Automations writing to this DE (' + matches.length + ")</div>" +
            matches.map(function (a) {
              return '<div class="relation-item">' +
                nativeLinkHtml(escHtml(a.name), "automation", a, "relation-item-name native-inline-link") +
                '<div class="relation-item-type">Query: ' +
                  nativeLinkHtml(escHtml(a.queryName), "query", { id: a.queryId }, "native-inline-link native-inline-link--mono") +
                  " · Status: " + escHtml(a.status) +
                "</div>" +
                (a.sql ? '<div class="sql-block">' + escHtml(a.sql.substring(0, 300)) + (a.sql.length > 300 ? "\n…" : "") + "</div>" : "") +
              "</div>";
            }).join("") +
          "</div>";
      }
    }).catch(function () {
      var sec = $("de-automations-section");
      if (sec) sec.innerHTML = '<div class="detail-section"><div class="detail-section-title">Automations</div><div class="no-results" style="color:var(--yellow)">Could not load automations.</div></div>';
    });

    // Async: find journeys using this DE
    findJourneysForDe(de.customerKey, de.name).then(function (matches) {
      var sec = $("de-journeys-section");
      if (!sec) return;
      if (matches.length === 0) {
        sec.innerHTML =
          '<div class="detail-section">' +
            '<div class="detail-section-title">Journey connections</div>' +
            '<div class="no-results">No journeys found using this DE as entry source.</div>' +
          "</div>";
      } else {
        sec.innerHTML =
          '<div class="detail-section">' +
            '<div class="detail-section-title">Journey connections (' + matches.length + ")</div>" +
            matches.map(function (j) {
              return '<div class="relation-item">' +
                nativeLinkHtml(escHtml(j.name), "journey", j, "relation-item-name native-inline-link") +
                '<div class="relation-item-type">' +
                  '<span class="tag tag--' + (j.status === 'Active' || j.status === 'Running' ? 'green' : j.status === 'Draft' ? 'yellow' : 'muted') + '">' + escHtml(j.status) + '</span>' +
                  ' &nbsp;' + escHtml(j.role) +
                  (j.eventName && j.name !== j.eventName + " (event)" ? ' · Event: ' + escHtml(j.eventName) : '') +
                  (j.journeyCount ? ' · ' + j.journeyCount + ' active' : '') +
                "</div>" +
              "</div>";
            }).join("") +
          "</div>";
      }
    }).catch(function () {
      var sec = $("de-journeys-section");
      if (sec) sec.innerHTML = "";
    });
  }

  function detailRow(label, value) {
    return '<div class="detail-row">' +
      '<span class="detail-label">' + escHtml(label) + "</span>" +
      '<span class="detail-value">' + escHtml(String(value || "—")) + "</span>" +
    "</div>";
  }

  function pathRow(value) {
    return '<div class="detail-path-value">' +
      escHtml(String(value || "—")) +
    "</div>";
  }

  els.btnDeBack.addEventListener("click", function () {
    els.deDetail.classList.add("hidden");
    els.deList.classList.remove("hidden");
    els.deToolbar.classList.remove("hidden");
  });

  els.btnLoadDe.addEventListener("click", loadDataExtensions);

  // ─── Automation → DE mapping ──────────────────────────────────────────────────

  function getAutomationItems(data) {
    var items = data && (data.entry || data.items || data.automations || data);
    return Array.isArray(items) ? items : [];
  }

  function getAutomationTotal(data) {
    if (!data) return null;
    return data.totalResults || data.totalCount || data.total || null;
  }

  function normalizeAutomationSummary(a) {
    return {
      id:       a.id || a.automationId || "",
      name:     a.name || "—",
      key:      a.key  || a.customerKey || "",
      status:   a.status || "—",
      schedule: a.schedule ? (a.schedule.scheduleTypeId === 1 ? "Scheduled" : "Triggered") : "—",
      lastRunTime: a.lastRunTime || null
    };
  }

  function loadAutomationPages(page, pageSize, acc, knownTotal, onProgress) {
    return SfmcApi.getAutomations(page, pageSize).then(function (data) {
      var pageItems = getAutomationItems(data);
      var total = getAutomationTotal(data) || knownTotal;
      acc = acc.concat(pageItems);

      if (onProgress) onProgress(acc.length, total);

      if ((total && acc.length >= total) || pageItems.length < pageSize || page >= 200) {
        return { items: acc, total: total || acc.length };
      }

      return loadAutomationPages(page + 1, pageSize, acc, total, onProgress);
    });
  }

  function getAllAutomations() {
    if (state.allAutomations) {
      return Promise.resolve(state.allAutomations);
    }
    return loadAutomationPages(1, 500, [], null, function (loaded, total) {
      if (state.automations.loading && els.autoCount) {
        els.autoCount.textContent = total
          ? loaded + " / " + total + " automations"
          : "Loading " + loaded + "...";
      }
      if (state.queries.scanning && els.queryLoadingLabel) {
        els.queryLoadingLabel.textContent = total
          ? "Loading automations " + loaded + " / " + total + "..."
          : "Loading automations " + loaded + "...";
      }
    }).then(function (result) {
      var seen = {};
      state.allAutomations = result.items.filter(function (auto) {
        var key = String(auto.id || auto.automationId || auto.key || auto.name || "").toLowerCase();
        if (!key) return true;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
      state.automations.items = state.allAutomations.map(normalizeAutomationSummary);
      state.automations.loaded = true;
      els.autoCount.textContent = state.automations.items.length + " automations";
      renderAutoList(els.globalSearch.value.trim());
      setLoadedButtonLabels();
      savePopupCache();
      return state.allAutomations;
    });
  }

  function getRelationKey(deKey, deName) {
    return ((deKey || "") + "||" + (deName || "")).toLowerCase();
  }

  function getAutomationDetailCached(auto) {
    var id = auto && (auto.id || auto.automationId);
    if (!id) return Promise.resolve(null);
    if (state.relations.automationDetailsById[id]) {
      return Promise.resolve(state.relations.automationDetailsById[id]);
    }
    return SfmcApi.getAutomationById(id).then(function (detail) {
      state.relations.automationDetailsById[id] = detail;
      return detail;
    });
  }

  function getQueryActivitySqlCached(activityObjectId) {
    if (!activityObjectId) return Promise.resolve("");
    if (Object.prototype.hasOwnProperty.call(state.relations.querySqlById, activityObjectId)) {
      return Promise.resolve(state.relations.querySqlById[activityObjectId]);
    }
    return SfmcApi.getQueryActivityById(activityObjectId)
      .then(function (q) {
        var sql = q.queryText || q.query || q.queryDefinition && q.queryDefinition.queryText || "";
        state.relations.querySqlById[activityObjectId] = sql;
        return sql;
      })
      .catch(function () {
        state.relations.querySqlById[activityObjectId] = "";
        return "";
      });
  }

  function findAutomationsForDe(deKey, deName) {
    var cacheKey = getRelationKey(deKey, deName);
    if (state.relations.automationMatchesByDe[cacheKey]) {
      return Promise.resolve(state.relations.automationMatchesByDe[cacheKey]);
    }

    return getAllAutomations().then(function (automations) {
      var matches = [];
      var detailPromises = [];

      automations.forEach(function (auto) {
        var p = getAutomationDetailCached(auto).then(function (detail) {
          if (!detail || !detail.steps) return;

          detail.steps.forEach(function (step) {
            if (!step.activities) return;
            step.activities.forEach(function (act) {
              // objectTypeId 300 = QueryActivity
              if (act.objectTypeId !== 300) return;

              var target = act.targetObject || {};
              var targetKey  = (target.key  || "").toLowerCase();
              var targetName = (target.name || "").toLowerCase();
              var deKeyLow   = (deKey  || "").toLowerCase();
              var deNameLow  = (deName || "").toLowerCase();

              var match = (deKeyLow  && targetKey  === deKeyLow) ||
                          (deNameLow && targetName === deNameLow);

              if (match) {
                matches.push({
                  id:        detail.id || auto.id || auto.automationId || "",
                  key:       detail.key || auto.key || auto.customerKey || "",
                  name:      detail.name || auto.name || "—",
                  status:    detail.status || auto.status || "—",
                  queryId:   act.activityObjectId || act.objectId || "",
                  queryName: act.name || "Query Activity",
                  targetKey: target.key || "",
                  sql:       "" // SQL not in this endpoint — fetch separately if needed
                });
              }
            });
          });
        }).catch(function () {});

        detailPromises.push(p);
      });

      return Promise.all(detailPromises).then(function () {
        state.relations.automationMatchesByDe[cacheKey] = matches;
        savePopupCache();
        return matches;
      });
    });
  }

  // ─── Journey → DE mapping ────────────────────────────────────────────────────

  function findJourneysForDe(deKey, deName) {
    var cacheKey = getRelationKey(deKey, deName);
    if (state.relations.journeyMatchesByDe[cacheKey]) {
      return Promise.resolve(state.relations.journeyMatchesByDe[cacheKey]);
    }

    // Journey entry sources are stored in Event Definitions, not in the Journey itself
    // eventDefinition.dataExtensionId links a DE to one or more Journeys
    return getEventDefinitionsCached().then(function (eventDefs) {
      var matches   = [];
      var deIdLow   = (deKey  || "").toLowerCase();
      var deNameLow = (deName || "").toLowerCase();

      // Find event definitions that reference this DE
      var matchingEvents = eventDefs.filter(function (ev) {
        var evDeId   = (ev.dataExtensionId   || "").toLowerCase();
        var evDeName = (ev.dataExtensionName || "").toLowerCase();
        return (deIdLow   && evDeId   === deIdLow) ||
               (deNameLow && evDeName === deNameLow);
      });

      if (matchingEvents.length === 0) {
        state.relations.journeyMatchesByDe[cacheKey] = matches;
        savePopupCache();
        return matches;
      }

      // For each matching event def, find the journeys that use it
      return getJourneysRawCached().then(function (journeys) {
        matchingEvents.forEach(function (ev) {
          // Find journeys linked to this event definition
          var linkedJourneys = journeys.filter(function (j) {
            var jStr = JSON.stringify(j.defaults || {}) + JSON.stringify(j.metaData || {});
            return jStr.toLowerCase().includes((ev.eventDefinitionKey || "").toLowerCase()) ||
                   jStr.toLowerCase().includes((ev.id || "").toLowerCase());
          });

          if (linkedJourneys.length > 0) {
            linkedJourneys.forEach(function (j) {
              matches.push({
                id:        j.id || "",
                version:   j.version || j.versionNumber || 1,
                url:       j.url || j.link || j.nativeUrl || "",
                name:      j.name || "—",
                status:    j.status || "—",
                role:      "Entry Source",
                eventName: ev.name || "—",
                journeyCount: ev.interactionCount || ev.publishedInteractionCount || null
              });
            });
          } else if (ev.interactionCount > 0 || ev.publishedInteractionCount > 0) {
            // Event def references DE but we couldn't match the specific journey
            matches.push({
              id:        ev.id || "",
              name:      ev.name + " (event)",
              status:    "Active",
              role:      "Entry Source",
              eventName: ev.name,
              journeyCount: ev.interactionCount || ev.publishedInteractionCount
            });
          }
        });

        state.relations.journeyMatchesByDe[cacheKey] = matches;
        savePopupCache();
        return matches;
      });
    }).catch(function () { return []; });
  }

  function getEventDefinitionsCached() {
    if (state.relations.eventDefinitions) {
      return Promise.resolve(state.relations.eventDefinitions);
    }
    return SfmcApi.getEventDefinitions().then(function (data) {
      var eventDefs = data.items || [];
      state.relations.eventDefinitions = eventDefs;
      savePopupCache();
      return eventDefs;
    });
  }

  function getJourneysRawCached() {
    if (state.relations.journeysRaw) {
      return Promise.resolve(state.relations.journeysRaw);
    }
    return loadJourneyPages(1, 100, [], null, null).then(function (result) {
      var journeys = result.items || [];
      state.relations.journeysRaw = journeys;
      savePopupCache();
      return journeys;
    });
  }

  // ─── AUTOMATIONS TAB ─────────────────────────────────────────────────────────

  function renderAutoList(query) {
    if (!state.automations.loaded) return;
    var q = (query || "").toLowerCase();
    var items = state.automations.items.filter(function (a) {
      if (!q) return true;
      return (a.name && a.name.toLowerCase().includes(q)) ||
             (a.key  && a.key.toLowerCase().includes(q));
    });

    if (items.length === 0) {
      els.autoList.innerHTML = '<div class="no-results">No automations found.</div>';
      return;
    }

    els.autoCount.textContent = items.length + " automation" + (items.length !== 1 ? "s" : "");
    els.autoList.innerHTML = items.map(function (a) {
      return '<div class="list-item" data-id="' + escHtml(a.id) + '">' +
        '<div class="list-item-main">' +
          '<div class="list-item-name">' + highlight(a.name, q) + "</div>" +
          '<div class="list-item-sub">' + highlight(a.key, q) + " · " + (a.schedule || "No schedule") + "</div>" +
        "</div>" +
        '<div class="list-item-badges">' + statusTag(a.status) + "</div>" +
      "</div>";
    }).join("");

    els.autoList.querySelectorAll(".list-item").forEach(function (el) {
      el.addEventListener("click", function () {
        var id   = el.dataset.id;
        var auto = state.automations.items.find(function (a) { return a.id === id; });
        if (auto) showAutoDetail(auto);
      });
    });
  }

  function loadAutomations() {
    if (!state.session || !state.session.isValid || state.automations.loading) return;
    state.automations.loading = true;
    els.autoLoading.classList.remove("hidden");
    els.autoList.innerHTML = "";
    state.allAutomations = null;
    state.relations.automationMatchesByDe = {};
    state.relations.automationMatchesByQueryId = {};
    state.relations.automationDetailsById = {};
    setLoadedButtonLabels();

    getAllAutomations().then(function () {
      state.automations.loading = false;
      els.autoLoading.classList.add("hidden");
      setLoadedButtonLabels();
      if (state.queries.loaded) {
        return buildAutomationMatchesByQueryId(true).then(function () {
          renderQueryResults(els.querySearchInput.value.trim());
        });
      }
    }).catch(function (err) {
      state.automations.loading = false;
      els.autoLoading.classList.add("hidden");
      setLoadedButtonLabels();
      els.autoList.innerHTML = '<div class="no-results" style="color:var(--red)">' + escHtml(err.message) + "</div>";
    });
  }

  function showAutoDetail(auto) {
    els.autoList.classList.add("hidden");
    els.autoToolbar.classList.add("hidden");
    els.autoDetail.classList.remove("hidden");

    els.autoDetailContent.innerHTML =
      nativeTitleHtml(auto.name, "automation", auto) +
      '<div class="detail-key">' + escHtml(auto.key) + "</div>" +
      '<div class="detail-section">' +
        '<div class="detail-section-title">Properties</div>' +
        detailRow("Status",    auto.status) +
        detailRow("Schedule",  auto.schedule) +
        detailRow("Last run",  fmt(auto.lastRunTime)) +
      "</div>" +
      '<div id="auto-activities-section">' +
        '<div class="loader-wrap"><div class="spinner"></div><span>Loading activities…</span></div>' +
      "</div>";

    getAutomationDetailCached(auto).then(function (detail) {
      var activities = [];
      if (detail && detail.steps) {
        detail.steps.forEach(function (step) {
          if (step.activities) step.activities.forEach(function (a) { activities.push(a); });
        });
      }

      var sec = $("auto-activities-section");
      if (!sec) return;

      if (activities.length === 0) {
        sec.innerHTML = '<div class="no-results">No activities found.</div>';
        return;
      }

      // Fetch SQL for all query activities in parallel (objectTypeId 300 = Query)
      var sqlPromises = activities.map(function (act) {
        if (act.objectTypeId === 300 && act.activityObjectId) {
          return getQueryActivitySqlCached(act.activityObjectId)
            .then(function (sql) { return { id: act.activityObjectId, sql: sql }; });
        }
        return Promise.resolve({ id: act.activityObjectId || "", sql: "" });
      });

      Promise.all(sqlPromises).then(function (sqlResults) {
        savePopupCache();
        var sqlMap = {};
        sqlResults.forEach(function (r) { if (r.id) sqlMap[r.id] = r.sql; });

        sec.innerHTML = '<div class="detail-section">' +
          '<div class="detail-section-title">Activities (' + activities.length + ")</div>" +
          activities.map(function (act) {
            var isQuery = act.objectTypeId === 300;
            var sql     = isQuery ? (sqlMap[act.activityObjectId] || "") : "";
            var target  = act.targetObject ? (act.targetObject.name || act.targetObject.key || "") : "";
            var typeLabel = isQuery ? "Query" : "Activity";

            var lintHtml = "";
            if (sql) {
              var lr = SqlLinter.lint(sql);
              var scoreClass = lr.score >= 80 ? "green" : lr.score >= 50 ? "yellow" : "red";
              lintHtml =
                '<div style="margin-top:8px;background:var(--bg-0);border:1px solid var(--border);border-radius:4px;padding:8px 10px;">' +
                  '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
                    '<span style="font-size:10px;color:var(--text-2);text-transform:uppercase;letter-spacing:.06em;">SQL</span>' +
                    '<div style="display:flex;gap:4px;align-items:center;">' +
                      '<span style="font-family:var(--mono);font-size:11px;color:var(--' + scoreClass + ')">Score ' + lr.score + '</span>' +
                      (lr.errorCount   ? '<span class="tag tag--red">' + lr.errorCount + ' err</span>'  : "") +
                      (lr.warningCount ? '<span class="tag tag--yellow">' + lr.warningCount + ' warn</span>' : "") +
                      (lr.infoCount    ? '<span class="tag tag--blue">' + lr.infoCount + ' info</span>'   : "") +
                    "</div>" +
                  "</div>" +
                  '<div class="sql-block" style="max-height:160px">' + escHtml(sql) + "</div>" +
                  (lr.diagnostics.length > 0 ?
                    '<div style="margin-top:6px">' +
                    lr.diagnostics.map(function(d) {
                      var cls = d.severity === "error" ? "red" : d.severity === "warning" ? "yellow" : "accent";
                      return '<div style="font-size:11px;padding:4px 0;border-top:1px solid var(--border);display:flex;gap:6px;">' +
                        '<span style="color:var(--' + cls + '");font-family:var(--mono);flex-shrink:0">' + escHtml(d.id) + '</span>' +
                        '<span style="color:var(--text-1)">' + escHtml(d.title) + '</span>' +
                      '</div>';
                    }).join("") +
                    "</div>"
                  : "") +
                "</div>";
            } else if (isQuery) {
              lintHtml = '<div style="font-size:11px;color:var(--text-2);margin-top:4px;font-style:italic">SQL not available</div>';
            }

            return '<div class="relation-item">' +
              '<div style="display:flex;align-items:center;justify-content:space-between">' +
                (isQuery
                  ? nativeLinkHtml(escHtml(act.name || "Unnamed Activity"), "query", act, "relation-item-name native-inline-link")
                  : '<div class="relation-item-name">' + escHtml(act.name || "Unnamed Activity") + "</div>") +
                '<span class="tag tag--' + (isQuery ? "blue" : "muted") + '">' + typeLabel + "</span>" +
              "</div>" +
              (target ? '<div class="relation-item-type">→ ' + escHtml(target) + "</div>" : "") +
              lintHtml +
            "</div>";
          }).join("") +
        "</div>";
      });

    }).catch(function () {
      var sec = $("auto-activities-section");
      if (sec) sec.innerHTML = '<div class="no-results" style="color:var(--yellow)">Could not load activity details.</div>';
    });

  }

  els.btnAutoBack.addEventListener("click", function () {
    els.autoDetail.classList.add("hidden");
    els.autoList.classList.remove("hidden");
    els.autoToolbar.classList.remove("hidden");
  });

  els.btnLoadAuto.addEventListener("click", loadAutomations);

  // ─── QUERY SEARCH TAB ───────────────────────────────────────────────────────

  function getQueryActivityItems(data) {
    var items = data && (data.items || data.entry || data.queries || data);
    return Array.isArray(items) ? items : [];
  }

  function getQueryActivityTotal(data) {
    if (!data) return null;
    return data.totalCount || data.totalResults || data.total || null;
  }

  function getQueryActivityId(q) {
    return q && (
      q.id ||
      q.objectId ||
      q.activityObjectId ||
      q.queryDefinitionId ||
      q.queryActivityId ||
      q.definitionId ||
      ""
    );
  }

  function getQueryTextFromPayload(q) {
    if (!q) return "";
    return q.queryText ||
      q.query ||
      q.sql ||
      (q.queryDefinition && q.queryDefinition.queryText) ||
      "";
  }

  function normalizeQueryActivity(summary, detail) {
    var src = Object.assign({}, summary || {}, detail || {});
    var id = getQueryActivityId(src) || getQueryActivityId(summary) || getQueryActivityId(detail);
    var targetObject = src.targetObject || src.targetDataExtension || src.dataExtension || {};
    var sql = getQueryTextFromPayload(src);

    if (id && !sql && Object.prototype.hasOwnProperty.call(state.relations.querySqlById, id)) {
      sql = state.relations.querySqlById[id];
    }
    if (id && sql) {
      state.relations.querySqlById[id] = sql;
    }

    return {
      id:           id || "",
      name:         src.name || src.queryName || src.activityName || "—",
      key:          src.key || src.customerKey || src.queryDefinitionKey || src.objectId || "",
      targetName:   src.targetName || src.targetObjectName || src.dataExtensionName || src.targetDataExtensionName || targetObject.name || "",
      targetKey:    src.targetKey || src.targetObjectKey || src.dataExtensionCustomerKey || src.targetDataExtensionKey || targetObject.key || targetObject.customerKey || "",
      queryText:    sql || "",
      createdDate:  src.createdDate || src.CreatedDate || null,
      modifiedDate: src.modifiedDate || src.ModifiedDate || null,
      error:        src.error || ""
    };
  }

  function getQuerySearchText(item) {
    var automationText = getAutomationMatchesForQuery(item).map(function (match) {
      return [
        match.automationName,
        match.automationKey,
        match.activityName,
        match.stepName,
        match.status
      ].join(" ");
    }).join("\n");

    return [
      item.name,
      item.key,
      item.targetName,
      item.targetKey,
      item.queryText,
      automationText
    ].join("\n").toLowerCase();
  }

  function countOccurrences(text, needle) {
    if (!text || !needle) return 0;
    var lower = String(text).toLowerCase();
    var q = String(needle).toLowerCase();
    var pos = 0;
    var count = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      count++;
      pos += q.length || 1;
    }
    return count;
  }

  function buildSqlSnippet(sql, query) {
    if (!sql) return "";
    var text = String(sql).replace(/\r\n/g, "\n");
    var q = (query || "").toLowerCase();
    var lower = text.toLowerCase();
    var idx = q ? lower.indexOf(q) : -1;
    var start = idx >= 0 ? Math.max(0, idx - 120) : 0;
    var end = idx >= 0 ? Math.min(text.length, idx + q.length + 220) : Math.min(text.length, 420);
    var snippet = text.substring(start, end);
    if (start > 0) snippet = "...\n" + snippet;
    if (end < text.length) snippet += "\n...";
    return highlight(snippet, query);
  }

  function updateQuerySearchSummary(filteredCount) {
    if (!state.queries.loaded) {
      els.queryCount.textContent = state.queries.scanning ? "Scanning..." : "—";
      return;
    }

    var label = typeof filteredCount === "number"
      ? filteredCount + " match" + (filteredCount !== 1 ? "es" : "")
      : state.queries.items.length + " quer" + (state.queries.items.length !== 1 ? "ies" : "y");
    els.queryCount.textContent = label;
  }

  function getQueryAutomationKey(value) {
    return String(value || "").toLowerCase();
  }

  function getAutomationActivityQueryId(act) {
    if (!act) return "";
    return act.activityObjectId ||
      act.objectId ||
      act.queryActivityId ||
      act.queryDefinitionId ||
      act.definitionId ||
      "";
  }

  function buildAutomationMatchesByQueryId(force) {
    if (!force && state.relations.automationMatchesByQueryId &&
        Object.keys(state.relations.automationMatchesByQueryId).length > 0) {
      return Promise.resolve(state.relations.automationMatchesByQueryId);
    }

    state.relations.automationMatchesByQueryId = {};

    return getAllAutomations().then(function (automations) {
      els.queryLoadingLabel.textContent = "Mapping Query Activities in automations...";

      return mapWithConcurrency(automations, 4, function (auto) {
        return getAutomationDetailCached(auto).then(function (detail) {
          if (!detail || !detail.steps) return null;

          detail.steps.forEach(function (step, stepIndex) {
            if (!step.activities) return;
            step.activities.forEach(function (act) {
              if (act.objectTypeId !== 300) return;

              var queryId = getAutomationActivityQueryId(act);
              var mapKey = getQueryAutomationKey(queryId);
              if (!mapKey) return;

              if (!state.relations.automationMatchesByQueryId[mapKey]) {
                state.relations.automationMatchesByQueryId[mapKey] = [];
              }

              state.relations.automationMatchesByQueryId[mapKey].push({
                automationId:   detail.id || auto.id || auto.automationId || "",
                automationKey:  detail.key || auto.key || auto.customerKey || "",
                automationName: detail.name || auto.name || "—",
                status:         detail.status || auto.status || "—",
                activityName:   act.name || "Query Activity",
                stepName:       step.name || ("Step " + (stepIndex + 1))
              });
            });
          });

          return null;
        }).catch(function () { return null; });
      }, function (done, total) {
        els.queryLoadingLabel.textContent = "Mapping automations " + done + " / " + total + "...";
      }).then(function () {
        Object.keys(state.relations.automationMatchesByQueryId).forEach(function (queryId) {
          var seen = {};
          state.relations.automationMatchesByQueryId[queryId] =
            state.relations.automationMatchesByQueryId[queryId].filter(function (match) {
              var key = [
                match.automationId,
                match.automationName,
                match.activityName,
                match.stepName
              ].join("|").toLowerCase();
              if (seen[key]) return false;
              seen[key] = true;
              return true;
            });
        });
        savePopupCache();
        return state.relations.automationMatchesByQueryId;
      });
    });
  }

  function getAutomationMatchesForQuery(item) {
    if (!item) return [];
    var keys = [
      item.id,
      item.key
    ].map(getQueryAutomationKey).filter(Boolean);

    for (var i = 0; i < keys.length; i++) {
      var matches = state.relations.automationMatchesByQueryId[keys[i]];
      if (matches && matches.length) return matches;
    }
    return [];
  }

  function renderAutomationUsage(matches) {
    if (!matches || matches.length === 0) {
      return '<div class="query-automation-list"><span class="tag tag--muted">No automation usage found</span></div>';
    }

    var visible = matches.slice(0, 3);
    return '<div class="query-automation-list">' +
      visible.map(function (match) {
        return '<span class="query-automation-pill" title="' + escHtml(match.activityName || "") + '">' +
          '<span class="query-automation-name">' + escHtml(match.automationName) + "</span>" +
          statusTag(match.status) +
        "</span>";
      }).join("") +
      (matches.length > visible.length ? '<span class="tag tag--muted">+' + (matches.length - visible.length) + "</span>" : "") +
    "</div>";
  }

  function renderQueryResults(query) {
    var q = (query || "").trim().toLowerCase();

    if (!state.queries.loaded) {
      if (!state.queries.scanning) {
        els.queryList.innerHTML = '<div class="no-results">Query metadata will index automatically when the SFMC session is ready.</div>';
      }
      return;
    }

    var items = state.queries.items.filter(function (item) {
      if (!q) return true;
      return getQuerySearchText(item).includes(q);
    });

    updateQuerySearchSummary(q ? items.length : undefined);

    if (items.length === 0) {
      els.queryList.innerHTML = '<div class="no-results">No query text matched your search.</div>';
      return;
    }

    var visible = items.slice(0, 100);
    els.queryList.innerHTML = visible.map(function (item) {
      var occurrenceCount = q ? countOccurrences(item.queryText, q) : 0;
      var modified = item.modifiedDate ? "Modified " + fmt(item.modifiedDate) : "";
      var automationMatches = getAutomationMatchesForQuery(item);
      var meta = [
        automationMatches.length + " automation" + (automationMatches.length !== 1 ? "s" : ""),
        modified
      ].filter(Boolean).join(" · ");

      return '<div class="query-result-item">' +
        '<div class="query-result-header">' +
          '<div class="list-item-main">' +
            nativeLinkHtml(highlight(item.name, q), "query", item, "list-item-name native-inline-link") +
            '<div class="list-item-sub">' + meta + "</div>" +
          "</div>" +
          '<div class="list-item-badges">' +
            (occurrenceCount ? '<span class="tag tag--blue">' + occurrenceCount + " hit" + (occurrenceCount !== 1 ? "s" : "") + "</span>" : "") +
          "</div>" +
        "</div>" +
        renderAutomationUsage(automationMatches) +
        (item.queryText
          ? '<div class="sql-block query-snippet">' + buildSqlSnippet(item.queryText, q) + "</div>"
          : '<div class="query-missing-sql">SQL text not available for this Query Activity.</div>') +
      "</div>";
    }).join("") +
    (items.length > visible.length
      ? '<div class="no-results">Showing first ' + visible.length + " of " + items.length + " matches. Narrow the search to see more.</div>"
      : "");
  }

  function loadQueryActivityPages(page, pageSize, acc, knownTotal) {
    return SfmcApi.getQueryActivities(page, pageSize).then(function (data) {
      var pageItems = getQueryActivityItems(data);
      var total = getQueryActivityTotal(data) || knownTotal;
      acc = acc.concat(pageItems);

      els.queryLoadingLabel.textContent = total
        ? "Found " + acc.length + " / " + total + " Query Activities..."
        : "Found " + acc.length + " Query Activities...";

      if ((total && acc.length >= total) || pageItems.length < pageSize || page >= 200) {
        return { items: acc, total: total || acc.length };
      }

      return loadQueryActivityPages(page + 1, pageSize, acc, total);
    });
  }

  function mapWithConcurrency(items, limit, worker, onProgress) {
    return new Promise(function (resolve) {
      var results = new Array(items.length);
      var nextIndex = 0;
      var active = 0;
      var done = 0;

      function launch() {
        if (done >= items.length) {
          resolve(results);
          return;
        }

        while (active < limit && nextIndex < items.length) {
          (function (index) {
            active++;
            Promise.resolve(worker(items[index], index))
              .then(function (result) { results[index] = result; })
              .catch(function () { results[index] = null; })
              .then(function () {
                active--;
                done++;
                if (onProgress) onProgress(done, items.length);
                launch();
              });
          })(nextIndex++);
        }
      }

      launch();
    });
  }

  function hydrateQueryActivities(rawItems) {
    return mapWithConcurrency(rawItems, 6, function (raw) {
      var seed = normalizeQueryActivity(raw, null);
      if (!seed.id || seed.queryText) return Promise.resolve(seed);

      return SfmcApi.getQueryActivityById(seed.id)
        .then(function (detail) {
          return normalizeQueryActivity(raw, detail);
        })
        .catch(function (err) {
          seed.error = err && err.message ? err.message : "Could not load detail";
          return seed;
        });
    }, function (done, total) {
      els.queryLoadingLabel.textContent = "Indexing SQL " + done + " / " + total + "...";
    });
  }

  function loadQueryIndex() {
    if (!state.session || !state.session.isValid || state.queries.scanning) return;

    state.queries.scanning = true;
    state.queries.loaded = false;
    state.queries.items = [];
    state.queries.total = null;
    state.relations.automationMatchesByQueryId = {};
    state.relations.querySqlById = {};
    els.querySearchInput.disabled = true;
    els.queryLoading.classList.remove("hidden");
    els.queryLoadingLabel.textContent = "Scanning Query Activities...";
    els.queryList.innerHTML = "";
    updateQuerySearchSummary();
    setLoadedButtonLabels();

    buildAutomationMatchesByQueryId(true)
      .then(function () {
        return loadQueryActivityPages(1, 250, [], null);
      })
      .then(function (result) {
        state.queries.total = result.total;
        return hydrateQueryActivities(result.items);
      })
      .then(function (items) {
        var seen = {};
        state.queries.items = items.filter(Boolean).filter(function (item) {
          var key = String(item.id || item.key || item.name || "").toLowerCase();
          if (!key) return true;
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        }).sort(function (a, b) {
          return (a.name || "").localeCompare(b.name || "");
        });
        state.queries.loaded = true;
        state.queries.scanning = false;
        state.queries.scannedAt = Date.now();
        els.queryLoading.classList.add("hidden");
        els.querySearchInput.disabled = false;
        updateQuerySearchSummary();
        setLoadedButtonLabels();
        renderQueryResults(els.querySearchInput.value.trim());
        savePopupCache();
      })
      .catch(function (err) {
        state.queries.scanning = false;
        state.queries.loaded = false;
        els.queryLoading.classList.add("hidden");
        els.queryList.innerHTML = '<div class="no-results" style="color:var(--red)">' + escHtml(err.message) + "</div>";
        updateQuerySearchSummary();
        setLoadedButtonLabels();
      });
  }

  function clearQueryIndex() {
    state.queries.items = [];
    state.queries.loaded = false;
    state.queries.scanning = false;
    state.queries.scannedAt = null;
    state.queries.total = null;
    state.relations.automationMatchesByQueryId = {};
    state.relations.querySqlById = {};
    els.querySearchInput.value = "";
    els.querySearchInput.disabled = true;
    els.queryLoading.classList.add("hidden");
    els.queryList.innerHTML = '<div class="no-results">Query metadata will index automatically when the SFMC session is ready.</div>';
    updateQuerySearchSummary();
    setLoadedButtonLabels();
    savePopupCache();
  }

  els.btnScanQueries.addEventListener("click", loadQueryIndex);
  els.btnClearQueryIndex.addEventListener("click", clearQueryIndex);
  els.btnOpenSqlSearch.addEventListener("click", openSqlSearchTab);
  els.btnOpenQueryEditor.addEventListener("click", openQueryEditorTab);
  els.btnOpenSqlSearchLarge.addEventListener("click", openSqlSearchTab);
  els.querySearchInput.addEventListener("input", function () {
    renderQueryResults(els.querySearchInput.value);
  });

  // ─── JOURNEYS TAB ────────────────────────────────────────────────────────────

  function renderJourneyList(query) {
    if (!state.journeys.loaded) return;
    var q = (query || "").toLowerCase();
    var items = state.journeys.items.filter(function (j) {
      if (!q) return true;
      return j.name && j.name.toLowerCase().includes(q);
    });

    if (items.length === 0) {
      els.journeyList.innerHTML = '<div class="no-results">No journeys found.</div>';
      return;
    }

    els.journeyCount.textContent = items.length + " journey" + (items.length !== 1 ? "s" : "");
    els.journeyList.innerHTML = items.map(function (j) {
      return '<div class="list-item">' +
        '<div class="list-item-main">' +
          nativeLinkHtml(highlight(j.name, q), "journey", j, "list-item-name native-inline-link") +
          '<div class="list-item-sub">v' + j.version + " · " + j.activityCount + " activities</div>" +
        "</div>" +
        '<div class="list-item-badges">' + statusTag(j.status) + "</div>" +
      "</div>";
    }).join("");
  }

  function getJourneyItems(data) {
    var items = data && (data.items || data.interactions || data.entry || data);
    return Array.isArray(items) ? items : [];
  }

  function getJourneyTotal(data) {
    if (!data) return null;
    return data.count || data.totalCount || data.totalResults || data.total || null;
  }

  function loadJourneyPages(page, pageSize, acc, knownTotal, onProgress) {
    return SfmcApi.getJourneys(page, pageSize).then(function (data) {
      var pageItems = getJourneyItems(data);
      var total = getJourneyTotal(data) || knownTotal;
      acc = acc.concat(pageItems);

      if (onProgress) onProgress(acc.length, total);

      if ((total && acc.length >= total) || pageItems.length < pageSize || page >= 200) {
        return { items: acc, total: total || acc.length };
      }

      return loadJourneyPages(page + 1, pageSize, acc, total, onProgress);
    });
  }

  function loadJourneys() {
    if (!state.session || !state.session.isValid || state.journeys.loading) return;
    state.journeys.loading = true;
    els.journeyLoading.classList.remove("hidden");
    els.journeyList.innerHTML = "";
    setLoadedButtonLabels();

    loadJourneyPages(1, 100, [], null, function (loaded, total) {
      els.journeyCount.textContent = total
        ? loaded + " / " + total + " journeys"
        : "Loading " + loaded + "...";
    }).then(function (result) {
      state.journeys.loading = false;
      els.journeyLoading.classList.add("hidden");
      var rawJourneys = result.items || [];
      var items = rawJourneys.map(function (j) {
        return {
          id:            j.id || "",
          url:           j.url || j.link || j.nativeUrl || "",
          name:          j.name || "—",
          status:        j.status || "—",
          version:       j.version || j.versionNumber || 1,
          activityCount: j.activities ? j.activities.length : 0
        };
      });
      state.journeys.items  = items;
      state.journeys.loaded = true;
      state.relations.journeysRaw = rawJourneys;
      state.relations.journeyMatchesByDe = {};
      els.journeyCount.textContent = items.length + " journeys";
      setLoadedButtonLabels();
      renderJourneyList(els.globalSearch.value.trim());
      savePopupCache();
    }).catch(function (err) {
      state.journeys.loading = false;
      els.journeyLoading.classList.add("hidden");
      setLoadedButtonLabels();
      els.journeyList.innerHTML = '<div class="no-results" style="color:var(--red)">' + escHtml(err.message) + "</div>";
    });
  }

  els.btnLoadJourneys.addEventListener("click", loadJourneys);

  // ─── LINTER TAB ──────────────────────────────────────────────────────────────

  document.querySelectorAll(".mode-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.linterMode = btn.dataset.mode;
      document.querySelectorAll(".mode-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      els.linterInput.placeholder = state.linterMode === "sql"
        ? "Paste your SQL query here…"
        : "Paste your AMPScript block here…";
      els.linterResults.classList.add("hidden");
      els.linterResults.innerHTML = "";
    });
  });

  els.btnLint.addEventListener("click", function () {
    var code   = els.linterInput.value.trim();
    if (!code) return;

    var result = state.linterMode === "sql"
      ? SqlLinter.lint(code)
      : AmpscriptLinter.lint(code);

    renderLintResults(result);
  });

  els.btnLintClear.addEventListener("click", function () {
    els.linterInput.value = "";
    els.linterResults.classList.add("hidden");
    els.linterResults.innerHTML = "";
  });

  function renderLintResults(result) {
    els.linterResults.classList.remove("hidden");

    var scoreClass = result.score >= 80 ? "good" : result.score >= 50 ? "ok" : "bad";
    var html = '<div class="score-bar">' +
      '<div class="score-number ' + scoreClass + '">' + result.score + "</div>" +
      '<div>' +
        '<div class="score-label">Quality score</div>' +
        '<div class="score-counts">' +
          (result.errorCount   ? '<span style="color:var(--red)">'    + result.errorCount   + " error"   + (result.errorCount   > 1 ? "s" : "") + "</span> " : "") +
          (result.warningCount ? '<span style="color:var(--yellow)">' + result.warningCount + " warning" + (result.warningCount > 1 ? "s" : "") + "</span> " : "") +
          (result.infoCount    ? '<span style="color:var(--accent)">' + result.infoCount    + " info"    + (result.infoCount    > 1 ? "s" : "") + "</span>"  : "") +
          (!result.errorCount && !result.warningCount && !result.infoCount ? '<span style="color:var(--green)">All clear</span>' : "") +
        "</div>" +
      "</div>" +
    "</div>";

    if (result.diagnostics.length === 0) {
      html += '<div class="clean-result">' +
        '<div class="clean-result-icon">✓</div>' +
        '<div>No issues found</div>' +
      "</div>";
    } else {
      html += result.diagnostics.map(function (d) {
        return '<div class="diag-card ' + d.severity + '">' +
          '<div class="diag-header">' +
            '<span class="diag-id">' + escHtml(d.id) + "</span>" +
            '<span class="diag-title">' + escHtml(d.title) + "</span>" +
            '<span class="diag-severity ' + d.severity + '">' + d.severity.toUpperCase() + "</span>" +
          "</div>" +
          '<div class="diag-message">' + escHtml(d.message) + "</div>" +
          '<div class="diag-fix"><span class="diag-fix-label">Fix →</span>' + escHtml(d.fix) + "</div>" +
        "</div>";
      }).join("");
    }

    els.linterResults.innerHTML = html;
  }

  // ─── Refresh ─────────────────────────────────────────────────────────────────

  els.btnRefresh.addEventListener("click", function () {
    resetLoadedData();
    clearPopupCache().then(loadSession);
  });

  // ─── Init ────────────────────────────────────────────────────────────────────

  loadSession();

})();
