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
      filtered:  []
    },
    automations: {
      items:     [],
      loaded:    false,
      filtered:  []
    },
    journeys: {
      items:     [],
      loaded:    false,
      filtered:  []
    },
    // Cached full automation list for DE→Automation mapping
    allAutomations: null,
    relations: {
      automationMatchesByDe: {},
      journeyMatchesByDe:    {},
      automationDetailsById: {},
      querySqlById:          {},
      eventDefinitions:      null,
      journeysRaw:           null
    }
  };

  var POPUP_CACHE_KEY     = "sfmcInspectorPopupCache";
  var POPUP_CACHE_VERSION = 1;

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
    deCount:        $("de-count"),
    btnLoadDe:      $("btn-load-de"),
    deLoading:      $("de-loading"),
    deList:         $("de-list"),
    deDetail:       $("de-detail"),
    deDetailContent: $("de-detail-content"),
    btnDeBack:      $("btn-de-back"),

    // Automations tab
    autoCount:      $("auto-count"),
    btnLoadAuto:    $("btn-load-auto"),
    autoLoading:    $("auto-loading"),
    autoList:       $("auto-list"),
    autoDetail:     $("auto-detail"),
    autoDetailContent: $("auto-detail-content"),
    btnAutoBack:    $("btn-auto-back"),

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

  function emptyRelations() {
    return {
      automationMatchesByDe: {},
      journeyMatchesByDe:    {},
      automationDetailsById: {},
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
      if (!chrome.storage || !chrome.storage.session) {
        resolve(null);
        return;
      }
      chrome.storage.session.get(POPUP_CACHE_KEY, function (result) {
        resolve(result && result[POPUP_CACHE_KEY] ? result[POPUP_CACHE_KEY] : null);
      });
    });
  }

  function getPersistableRelations() {
    return {
      automationMatchesByDe: state.relations.automationMatchesByDe,
      journeyMatchesByDe:    state.relations.journeyMatchesByDe,
      // Full automation details can become large; keep them in popup memory only.
      automationDetailsById: {},
      querySqlById:          state.relations.querySqlById,
      eventDefinitions:      state.relations.eventDefinitions,
      journeysRaw:           state.relations.journeysRaw
    };
  }

  function savePopupCache() {
    if (!state.session || !state.session.isValid || !chrome.storage || !chrome.storage.session) return;

    var payload = {};
    payload[POPUP_CACHE_KEY] = {
      version:        POPUP_CACHE_VERSION,
      sessionKey:     getSessionCacheKey(state.session),
      updatedAt:      Date.now(),
      de:             { items: state.de.items, loaded: state.de.loaded },
      automations:    { items: state.automations.items, loaded: state.automations.loaded },
      journeys:       { items: state.journeys.items, loaded: state.journeys.loaded },
      allAutomations: state.allAutomations,
      relations:      getPersistableRelations()
    };

    chrome.storage.session.set(payload, function () {
      if (chrome.runtime.lastError) {
        console.warn("[SFMC Inspector Popup] Could not save session cache:", chrome.runtime.lastError.message);
      }
    });
  }

  function clearPopupCache() {
    if (!chrome.storage || !chrome.storage.session) return Promise.resolve();
    return new Promise(function (resolve) {
      chrome.storage.session.remove(POPUP_CACHE_KEY, resolve);
    });
  }

  function setLoadedButtonLabels() {
    els.btnLoadDe.textContent       = state.de.loaded ? "Reload" : "Load";
    els.btnLoadAuto.textContent     = state.automations.loaded ? "Reload" : "Load";
    els.btnLoadJourneys.textContent = state.journeys.loaded ? "Reload" : "Load";
  }

  function resetLoadedData() {
    state.de.items = [];
    state.de.loaded = false;
    state.automations.items = [];
    state.automations.loaded = false;
    state.journeys.items = [];
    state.journeys.loaded = false;
    state.allAutomations = null;
    state.relations = emptyRelations();

    els.deList.innerHTML = "";
    els.autoList.innerHTML = "";
    els.journeyList.innerHTML = "";
    els.deCount.textContent = "—";
    els.autoCount.textContent = "—";
    els.journeyCount.textContent = "—";
    els.deDetail.classList.add("hidden");
    els.autoDetail.classList.add("hidden");
    els.deList.classList.remove("hidden");
    els.autoList.classList.remove("hidden");
    document.querySelector(".panel-toolbar").classList.remove("hidden");
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

      if (cache.automations && cache.automations.loaded) {
        state.automations.items = Array.isArray(cache.automations.items) ? cache.automations.items : [];
        state.automations.loaded = true;
        els.autoCount.textContent = state.automations.items.length + " automations";
        renderAutoList(els.globalSearch.value.trim());
      }

      if (cache.journeys && cache.journeys.loaded) {
        state.journeys.items = Array.isArray(cache.journeys.items) ? cache.journeys.items : [];
        state.journeys.loaded = true;
        els.journeyCount.textContent = state.journeys.items.length + " journeys";
        renderJourneyList(els.globalSearch.value.trim());
      }

      if (Object.prototype.hasOwnProperty.call(cache, "allAutomations")) {
        state.allAutomations = cache.allAutomations;
      }
      state.relations = Object.assign(emptyRelations(), cache.relations || {});
      setLoadedButtonLabels();
    });
  }

  // ─── Session ─────────────────────────────────────────────────────────────────

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
      restoreCachedState(session);
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

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.id === "tab-" + tabId);
    });
  }

  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
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
    if (!state.session || !state.session.isValid) return;
    els.deLoading.classList.remove("hidden");
    els.deList.innerHTML = "";
    els.deCount.textContent = "Loading…";

    SfmcApi.getDataExtensions().then(function (data) {
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
      els.deLoading.classList.add("hidden");
      els.deList.innerHTML = '<div class="no-results" style="color:var(--red)">' + escHtml(err.message) + "</div>";
    });
  }

  function showDeDetail(de) {
    els.deList.classList.add("hidden");
    document.querySelector(".panel-toolbar").classList.add("hidden");
    els.deDetail.classList.remove("hidden");

    // Render basic info immediately
    els.deDetailContent.innerHTML =
      '<div class="detail-title">' + escHtml(de.name) + "</div>" +
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
                '<div class="relation-item-name">' + escHtml(a.name) + "</div>" +
                '<div class="relation-item-type">Query: ' + escHtml(a.queryName) + " · Status: " + escHtml(a.status) + "</div>" +
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
                '<div class="relation-item-name">' + escHtml(j.name) + "</div>" +
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
    document.querySelector(".panel-toolbar").classList.remove("hidden");
  });

  els.btnLoadDe.addEventListener("click", loadDataExtensions);

  // ─── Automation → DE mapping ──────────────────────────────────────────────────

  function getAllAutomations() {
    if (state.allAutomations) {
      return Promise.resolve(state.allAutomations);
    }
    return SfmcApi.getAutomations(1, 1000).then(function (data) {
      // Legacy endpoint returns {entry: [...], totalResults: N}
      var items = data.entry || data.items || data.automations || [];
      if (!Array.isArray(items)) items = [];
      state.allAutomations = items;
      savePopupCache();
      return items;
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
                  name:      detail.name || auto.name || "—",
                  status:    detail.status || auto.status || "—",
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
    return SfmcApi.getJourneys().then(function (data) {
      var journeys = data.items || data.interactions || data || [];
      if (!Array.isArray(journeys)) journeys = [];
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
    els.autoLoading.classList.remove("hidden");
    els.autoList.innerHTML = "";

    SfmcApi.getAutomations(1, 200).then(function (data) {
      els.autoLoading.classList.add("hidden");
      // Legacy automation endpoint returns {entry: [...], totalResults: N}
      var raw = data.entry || data.items || data.automations || data || [];
      if (!Array.isArray(raw)) raw = [];
      var items = raw.map(function (a) {
        return {
          id:       a.id || a.automationId || "",
          name:     a.name || "—",
          key:      a.key  || a.customerKey || "",
          status:   a.status || "—",
          schedule: a.schedule ? (a.schedule.scheduleTypeId === 1 ? "Scheduled" : "Triggered") : "—",
          lastRunTime: a.lastRunTime || null
        };
      });
      state.automations.items  = items;
      state.automations.loaded = true;
      state.allAutomations = raw;
      state.relations.automationMatchesByDe = {};
      state.relations.automationDetailsById = {};
      els.autoCount.textContent = items.length + " automations";
      setLoadedButtonLabels();
      renderAutoList(els.globalSearch.value.trim());
      savePopupCache();
    }).catch(function (err) {
      els.autoLoading.classList.add("hidden");
      els.autoList.innerHTML = '<div class="no-results" style="color:var(--red)">' + escHtml(err.message) + "</div>";
    });
  }

  function showAutoDetail(auto) {
    els.autoList.classList.add("hidden");
    els.autoDetail.classList.remove("hidden");

    els.autoDetailContent.innerHTML =
      '<div class="detail-title">' + escHtml(auto.name) + "</div>" +
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
                '<div class="relation-item-name">' + escHtml(act.name || "Unnamed Activity") + "</div>" +
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
  });

  els.btnLoadAuto.addEventListener("click", loadAutomations);

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
          '<div class="list-item-name">' + highlight(j.name, q) + "</div>" +
          '<div class="list-item-sub">v' + j.version + " · " + j.activityCount + " activities</div>" +
        "</div>" +
        '<div class="list-item-badges">' + statusTag(j.status) + "</div>" +
      "</div>";
    }).join("");
  }

  function loadJourneys() {
    els.journeyLoading.classList.remove("hidden");
    els.journeyList.innerHTML = "";

    SfmcApi.getJourneys(1, 100).then(function (data) {
      els.journeyLoading.classList.add("hidden");
      var items = (data.items || data.interactions || data || []).map(function (j) {
        return {
          id:            j.id || "",
          name:          j.name || "—",
          status:        j.status || "—",
          version:       j.version || 1,
          activityCount: j.activities ? j.activities.length : 0
        };
      });
      state.journeys.items  = items;
      state.journeys.loaded = true;
      state.relations.journeysRaw = data.items || data.interactions || data || [];
      state.relations.journeyMatchesByDe = {};
      els.journeyCount.textContent = items.length + " journeys";
      setLoadedButtonLabels();
      renderJourneyList(els.globalSearch.value.trim());
      savePopupCache();
    }).catch(function (err) {
      els.journeyLoading.classList.add("hidden");
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
