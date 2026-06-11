/**
 * SFMC Inspector Reloaded - Metadata Explorer page.
 */

(function () {
  "use strict";

  var state = {
    session: null,
    cache: null,
    activeType: "dataExtension",
    selected: null,
    loading: false,
    automationDetailsById: {},
    eventDefinitions: null,
    journeyDetailsById: {}
  };

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    sessionBadge: $("session-badge"),
    sessionLabel: $("session-label"),
    sessionHost: $("session-host"),
    btnRefresh: $("btn-refresh"),
    cacheLabel: $("cache-label"),
    loadStatus: $("load-status"),
    progressBar: $("progress-bar"),
    progressLabel: $("progress-label"),
    deCount: $("de-count"),
    automationCount: $("automation-count"),
    journeyCount: $("journey-count"),
    searchInput: $("search-input"),
    sectionTitle: $("section-title"),
    resultCount: $("result-count"),
    results: $("results"),
    detailEmpty: $("detail-empty"),
    detailContent: $("detail-content"),
    btnOpenSqlSearch: $("btn-open-sql-search"),
    btnOpenQueryEditor: $("btn-open-query-editor")
  };

  if (window.FeatureFlags) FeatureFlags.applyVisibility(document);

  function escHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(date) {
    if (!date) return "-";
    try {
      return new Date(date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    } catch (e) {
      return String(date);
    }
  }

  function highlight(text, query) {
    if (!query || !text) return escHtml(text);
    var re = new RegExp("(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    return escHtml(text).replace(re, '<span class="hl">$1</span>');
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

  function getTypeTitle(type) {
    if (type === "automation") return "Automations";
    if (type === "journey") return "Journeys";
    return "Data Extensions";
  }

  function getTypeCollection(type) {
    if (!state.cache) return [];
    if (type === "automation") return state.cache.automations.items || [];
    if (type === "journey") return state.cache.journeys.items || [];
    return state.cache.de.items || [];
  }

  function getObjectKey(item) {
    if (!item) return "";
    return String(item.id || item.customerKey || item.key || item.name || "");
  }

  function findObject(type, id, key) {
    var items = getTypeCollection(type);
    var idLow = String(id || "").toLowerCase();
    var keyLow = String(key || "").toLowerCase();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var candidates = [
        item.id,
        item.customerKey,
        item.key,
        item.name
      ].map(function (value) { return String(value || "").toLowerCase(); });
      if ((idLow && candidates.indexOf(idLow) !== -1) ||
          (keyLow && candidates.indexOf(keyLow) !== -1)) {
        return item;
      }
    }
    return null;
  }

  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  function updateUrlSelection(item) {
    if (!item) return;
    var params = new URLSearchParams();
    params.set("type", state.activeType);
    if (item.id) params.set("id", item.id);
    if (item.customerKey || item.key) params.set("key", item.customerKey || item.key);
    history.replaceState(null, "", window.location.pathname + "?" + params.toString());
  }

  function setProgress(label, loaded, total) {
    els.progressLabel.textContent = label;
    if (!total) {
      els.progressBar.style.width = state.loading ? "18%" : "0%";
      return;
    }
    var pct = Math.max(2, Math.min(100, Math.round((loaded / total) * 100)));
    els.progressBar.style.width = pct + "%";
  }

  function updateFromProgress(evt) {
    if (evt.section === "all") {
      state.loading = evt.status === "loading";
      els.loadStatus.textContent = evt.status === "loading" ? "Loading" : evt.status === "done" ? "Ready" : "Partial";
      setProgress(evt.label, evt.status === "done" ? 1 : 0, 1);
      return;
    }

    var loaded = evt.loaded || evt.count || 0;
    var total = evt.total || Math.max(loaded, 1);
    setProgress(evt.label || "Loading metadata...", loaded, total);
  }

  function detectSession() {
    els.sessionBadge.className = "badge badge--detecting";
    els.sessionLabel.textContent = "Detecting";

    return SfmcApi.getSession().then(function (session) {
      if (session && session.isValid) return session;

      return new Promise(function (resolve) {
        chrome.tabs.query({}, function (tabs) {
          var sfmcTab = null;
          for (var i = 0; i < tabs.length; i++) {
            var url = tabs[i].url || "";
            if (url.indexOf("exacttarget.com") !== -1 || url.indexOf("marketingcloud.com") !== -1) {
              sfmcTab = tabs[i];
              break;
            }
          }
          if (!sfmcTab) {
            resolve(null);
            return;
          }

          var match = (sfmcTab.url || "").match(/https?:\/\/([^/]+)/);
          if (!match) {
            resolve(null);
            return;
          }

          chrome.runtime.sendMessage({ type: "DETECT_SESSION", hostname: match[1] }, function (resp) {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }
            resolve(resp && resp.ok && resp.session ? resp.session : null);
          });
        });
      });
    });
  }

  function updateSessionUI(session) {
    state.session = session;
    if (session && session.isValid && session.hasToken) {
      els.sessionBadge.className = "badge badge--connected";
      els.sessionLabel.textContent = "Connected";
      els.sessionHost.textContent = session.hostname || session.subdomain || "SFMC";
      return true;
    }

    els.sessionBadge.className = "badge badge--error";
    els.sessionLabel.textContent = "No session";
    els.sessionHost.textContent = "Open Marketing Cloud in another tab";
    els.searchInput.disabled = true;
    els.results.innerHTML = '<div class="empty-row">No SFMC session detected.</div>';
    return false;
  }

  function renderCounts() {
    els.deCount.textContent = getTypeCollection("dataExtension").length;
    els.automationCount.textContent = getTypeCollection("automation").length;
    els.journeyCount.textContent = getTypeCollection("journey").length;
    els.cacheLabel.textContent = state.cache && state.cache.updatedAt ? fmt(state.cache.updatedAt) : "No cache";
  }

  function getSearchText(item, type) {
    if (type === "automation") {
      return [item.name, item.key, item.status, item.schedule].join(" ").toLowerCase();
    }
    if (type === "journey") {
      return [item.name, item.key, item.status, item.version].join(" ").toLowerCase();
    }
    return [item.name, item.customerKey, item.key, item.path].join(" ").toLowerCase();
  }

  function getItemSub(item, type) {
    if (type === "automation") {
      return [item.key, item.schedule, item.lastRunTime ? "Last run " + fmt(item.lastRunTime) : ""].filter(Boolean).join(" · ");
    }
    if (type === "journey") {
      return ["v" + item.version, item.activityCount + " activities"].join(" · ");
    }
    return [item.customerKey || item.key, item.path].filter(Boolean).join(" · ");
  }

  function renderResults() {
    var type = state.activeType;
    var q = els.searchInput.value.trim().toLowerCase();
    var items = getTypeCollection(type).filter(function (item) {
      return !q || getSearchText(item, type).indexOf(q) !== -1;
    });

    els.sectionTitle.textContent = getTypeTitle(type);
    els.resultCount.textContent = items.length + " result" + (items.length !== 1 ? "s" : "");
    els.searchInput.placeholder = "Search " + getTypeTitle(type).toLowerCase() + "...";

    if (items.length === 0) {
      els.results.innerHTML = '<div class="empty-row">No metadata matched this view.</div>';
      return;
    }

    els.results.innerHTML = items.map(function (item) {
      var active = state.selected && getObjectKey(state.selected) === getObjectKey(item);
      var badge = type === "dataExtension"
        ? (item.rowCount != null ? '<span class="tag tag--muted">' + Number(item.rowCount).toLocaleString() + " rows</span>" : "")
        : statusTag(item.status);

      return '<button class="result-item ' + (active ? "active" : "") + '" data-key="' + escHtml(getObjectKey(item)) + '">' +
        '<span class="result-main">' +
          '<span class="result-title">' + highlight(item.name, q) + "</span>" +
          '<span class="result-sub">' + highlight(getItemSub(item, type), q) + "</span>" +
        "</span>" +
        '<span class="result-badge">' + badge + "</span>" +
      "</button>";
    }).join("");
  }

  function selectType(type) {
    state.activeType = type;
    document.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.type === type);
    });
    els.searchInput.value = "";
    renderResults();
  }

  function selectItem(item, updateUrl) {
    state.selected = item;
    renderResults();
    renderDetail(item);
    if (updateUrl !== false) updateUrlSelection(item);
  }

  function openExtensionPage(path) {
    if (window.FeatureFlags && !FeatureFlags.canOpenPath(path)) return;
    chrome.tabs.create({ url: chrome.runtime.getURL(path) });
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

  function nativeButton(type, item) {
    var url = getNativeObjectUrl(type, item);
    if (!url) return "";
    var id = item.id || item.objectId || item.ObjectID || item.dataExtensionId || item.DataExtensionID || item.automationId || item.activityObjectId || item.queryActivityId || item.interactionId || item.definitionId || "";
    var version = item.version || item.versionNumber || "";
    return '<button class="small-btn native-open-link" data-native-type="' + escHtml(type) + '" data-native-id="' + escHtml(id) + '" data-native-version="' + escHtml(version) + '" data-url="' + escHtml(url) + '">Open in SFMC ↗</button>';
  }

  function detailHeader(item, type) {
    return '<div class="detail-header">' +
      '<div>' +
        '<div class="detail-title">' + escHtml(item.name) + "</div>" +
        '<div class="detail-key">' + escHtml(item.customerKey || item.key || item.id || "-") + "</div>" +
      "</div>" +
      '<div class="detail-actions">' + nativeButton(type, item) + "</div>" +
    "</div>";
  }

  function detailRow(label, value) {
    return '<div class="detail-row">' +
      '<span class="detail-label">' + escHtml(label) + "</span>" +
      '<span class="detail-value">' + escHtml(String(value || "-")) + "</span>" +
    "</div>";
  }

  function section(title, body) {
    return '<div class="detail-section">' +
      '<div class="detail-section-title">' + escHtml(title) + "</div>" +
      body +
    "</div>";
  }

  function renderDetail(item) {
    els.detailEmpty.classList.add("hidden");
    els.detailContent.classList.remove("hidden");

    if (state.activeType === "automation") {
      renderAutomationDetail(item);
    } else if (state.activeType === "journey") {
      renderJourneyDetail(item);
    } else {
      renderDataExtensionDetail(item);
    }
  }

  function renderDataExtensionDetail(de) {
    els.detailContent.innerHTML =
      detailHeader(de, "dataExtension") +
      section("Path", detailRow("Folder", de.path || "-")) +
      section("Properties",
        detailRow("Rows", de.rowCount != null ? Number(de.rowCount).toLocaleString() : "-") +
        detailRow("Sendable", de.isSendable ? "Yes" : "No") +
        detailRow("Testable", de.isTestable ? "Yes" : "No") +
        detailRow("Created", fmt(de.createdDate)) +
        detailRow("Modified", fmt(de.modifiedDate))
      ) +
      '<div id="de-automations-section">' + section("Automations writing to this DE", '<div class="loading-row">Scanning automations...</div>') + "</div>" +
      '<div id="de-journeys-section">' + section("Journey connections", '<div class="loading-row">Checking journeys...</div>') + "</div>";

    findAutomationsForDe(de.customerKey || de.key, de.name).then(function (matches) {
      var target = $("de-automations-section");
      if (!target) return;
      if (matches.length === 0) {
        target.innerHTML = section("Automations writing to this DE", '<div class="empty-row">No automations found targeting this DE.</div>');
        return;
      }
      target.innerHTML = section("Automations writing to this DE (" + matches.length + ")", matches.map(function (match) {
        return '<div class="relation-item">' +
          '<div class="relation-title">' + escHtml(match.name) + "</div>" +
          '<div class="relation-meta">Query: ' + escHtml(match.queryName) + " · Status: " + escHtml(match.status) + "</div>" +
        "</div>";
      }).join(""));
    });

    findJourneysForDe(de.customerKey || de.key, de.name).then(function (matches) {
      var target = $("de-journeys-section");
      if (!target) return;
      if (matches.length === 0) {
        target.innerHTML = section("Journey connections", '<div class="empty-row">No journeys found using this DE as entry source.</div>');
        return;
      }
      target.innerHTML = section("Journey connections (" + matches.length + ")", matches.map(function (match) {
        return '<div class="relation-item">' +
          '<div class="relation-title">' + escHtml(match.name) + "</div>" +
          '<div class="relation-meta">' + escHtml(match.role) + " · " + escHtml(match.status) + (match.eventName ? " · Event: " + escHtml(match.eventName) : "") + "</div>" +
        "</div>";
      }).join(""));
    });
  }

  function getRawAutomations() {
    return state.cache && state.cache.raw && Array.isArray(state.cache.raw.automations)
      ? state.cache.raw.automations
      : [];
  }

  function getAutomationDetailCached(auto) {
    var id = auto && (auto.id || auto.automationId);
    if (!id) return Promise.resolve(null);
    if (state.automationDetailsById[id]) return Promise.resolve(state.automationDetailsById[id]);
    return SfmcApi.getAutomationById(id).then(function (detail) {
      state.automationDetailsById[id] = detail;
      return detail;
    });
  }

  function findAutomationsForDe(deKey, deName) {
    var raw = getRawAutomations();
    var deKeyLow = String(deKey || "").toLowerCase();
    var deNameLow = String(deName || "").toLowerCase();
    var matches = [];

    return mapWithConcurrency(raw, 4, function (auto) {
      return getAutomationDetailCached(auto).then(function (detail) {
        if (!detail || !detail.steps) return null;
        detail.steps.forEach(function (step) {
          (step.activities || []).forEach(function (act) {
            if (act.objectTypeId !== 300) return;
            var target = act.targetObject || {};
            var targetKey = String(target.key || "").toLowerCase();
            var targetName = String(target.name || "").toLowerCase();
            if ((deKeyLow && targetKey === deKeyLow) || (deNameLow && targetName === deNameLow)) {
              matches.push({
                id: detail.id || auto.id || auto.automationId || "",
                name: detail.name || auto.name || "-",
                status: detail.status || auto.status || "-",
                queryId: act.activityObjectId || act.objectId || "",
                queryName: act.name || "Query Activity"
              });
            }
          });
        });
        return null;
      });
    }).then(function () {
      return matches;
    });
  }

  function renderAutomationDetail(auto) {
    els.detailContent.innerHTML =
      detailHeader(auto, "automation") +
      section("Properties",
        detailRow("Status", auto.status) +
        detailRow("Schedule", auto.schedule) +
        detailRow("Last run", fmt(auto.lastRunTime))
      ) +
      '<div id="automation-activities-section">' + section("Activities", '<div class="loading-row">Loading activities...</div>') + "</div>";

    getAutomationDetailCached(auto).then(function (detail) {
      var target = $("automation-activities-section");
      if (!target) return;
      var activities = [];
      if (detail && detail.steps) {
        detail.steps.forEach(function (step, stepIndex) {
          (step.activities || []).forEach(function (act) {
            activities.push({ stepName: step.name || ("Step " + (stepIndex + 1)), activity: act });
          });
        });
      }
      if (activities.length === 0) {
        target.innerHTML = section("Activities", '<div class="empty-row">No activities found.</div>');
        return;
      }

      target.innerHTML = section("Activities (" + activities.length + ")", activities.map(function (row) {
        var act = row.activity;
        var isQuery = act.objectTypeId === 300;
        var targetObject = act.targetObject || {};
        return '<div class="relation-item">' +
          '<div class="relation-title">' + escHtml(act.name || "Unnamed Activity") + " " + (isQuery ? '<span class="tag tag--blue">Query</span>' : '<span class="tag tag--muted">Activity</span>') + "</div>" +
          '<div class="relation-meta">' + escHtml(row.stepName) + (targetObject.name ? " · Target: " + escHtml(targetObject.name) : "") + "</div>" +
        "</div>";
      }).join(""));
    }).catch(function () {
      var target = $("automation-activities-section");
      if (target) target.innerHTML = section("Activities", '<div class="empty-row">Could not load activity details.</div>');
    });
  }

  function getRawJourney(summary) {
    var rawJourneys = state.cache && state.cache.raw && Array.isArray(state.cache.raw.journeys)
      ? state.cache.raw.journeys
      : [];
    for (var i = 0; i < rawJourneys.length; i++) {
      if (String(rawJourneys[i].id || "").toLowerCase() === String(summary.id || "").toLowerCase()) {
        return rawJourneys[i];
      }
    }
    return null;
  }

  function getJourneyDetailCached(journey) {
    var id = journey && journey.id;
    if (!id) return Promise.resolve(getRawJourney(journey) || journey);
    if (state.journeyDetailsById[id]) return Promise.resolve(state.journeyDetailsById[id]);
    var raw = getRawJourney(journey);
    if (raw && raw.activities) {
      state.journeyDetailsById[id] = raw;
      return Promise.resolve(raw);
    }
    return SfmcApi.getJourneyById(id).then(function (detail) {
      state.journeyDetailsById[id] = detail;
      return detail;
    }).catch(function () {
      return raw || journey;
    });
  }

  function renderJourneyDetail(journey) {
    els.detailContent.innerHTML =
      detailHeader(journey, "journey") +
      section("Properties",
        detailRow("Status", journey.status) +
        detailRow("Version", journey.version) +
        detailRow("Activities", journey.activityCount) +
        detailRow("Created", fmt(journey.createdDate)) +
        detailRow("Modified", fmt(journey.modifiedDate))
      ) +
      '<div id="journey-activities-section">' + section("Activities", '<div class="loading-row">Loading journey structure...</div>') + "</div>";

    getJourneyDetailCached(journey).then(function (detail) {
      var target = $("journey-activities-section");
      if (!target) return;
      var activities = detail && detail.activities ? detail.activities : [];
      if (activities.length === 0) {
        target.innerHTML = section("Activities", '<div class="empty-row">No activities available in the cached payload.</div>');
        return;
      }
      target.innerHTML = section("Activities (" + activities.length + ")", activities.map(function (act) {
        return '<div class="relation-item">' +
          '<div class="relation-title">' + escHtml(act.name || act.key || "Unnamed Activity") + "</div>" +
          '<div class="relation-meta">' + escHtml(act.type || act.activityType || act.category || "Activity") + "</div>" +
        "</div>";
      }).join(""));
    });
  }

  function getEventDefinitionsCached() {
    if (state.eventDefinitions) return Promise.resolve(state.eventDefinitions);
    return SfmcApi.getEventDefinitions().then(function (data) {
      state.eventDefinitions = data.items || [];
      return state.eventDefinitions;
    }).catch(function () {
      state.eventDefinitions = [];
      return [];
    });
  }

  function findJourneysForDe(deKey, deName) {
    var deKeyLow = String(deKey || "").toLowerCase();
    var deNameLow = String(deName || "").toLowerCase();

    return getEventDefinitionsCached().then(function (eventDefs) {
      var rawJourneys = state.cache && state.cache.raw && Array.isArray(state.cache.raw.journeys)
        ? state.cache.raw.journeys
        : [];
      var matches = [];

      eventDefs.forEach(function (ev) {
        var evDeId = String(ev.dataExtensionId || "").toLowerCase();
        var evDeName = String(ev.dataExtensionName || "").toLowerCase();
        var match = (deKeyLow && evDeId === deKeyLow) || (deNameLow && evDeName === deNameLow);
        if (!match) return;

        var linked = rawJourneys.filter(function (journey) {
          var haystack = (JSON.stringify(journey.defaults || {}) + JSON.stringify(journey.metaData || {})).toLowerCase();
          return haystack.indexOf(String(ev.eventDefinitionKey || "").toLowerCase()) !== -1 ||
                 haystack.indexOf(String(ev.id || "").toLowerCase()) !== -1;
        });

        if (linked.length === 0) {
          matches.push({
            name: ev.name || "Event definition",
            status: "Active",
            role: "Entry Source",
            eventName: ev.name || ""
          });
          return;
        }

        linked.forEach(function (journey) {
          matches.push({
            id: journey.id || "",
            name: journey.name || "-",
            status: journey.status || "-",
            role: "Entry Source",
            eventName: ev.name || "",
            version: journey.version || journey.versionNumber || 1
          });
        });
      });

      return matches;
    });
  }

  function mapWithConcurrency(items, limit, worker) {
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
                launch();
              });
          })(nextIndex++);
        }
      }

      launch();
    });
  }

  function openInSfmc(payload) {
    var nativeType = payload.type;
    var nativeId = payload.id;
    var nativeVersion = payload.version;
    var url = payload.url;

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
        if (resp && resp.error) window.alert(resp.error);
      });
      return;
    }

    chrome.tabs.create({ url: url });
  }

  function loadMetadata() {
    els.searchInput.disabled = true;
    state.loading = true;
    els.loadStatus.textContent = "Loading";
    setProgress("Checking local cache...", 0, 1);

    return MetadataStore.read(state.session).then(function (cache) {
      if (MetadataStore.isComplete(cache)) {
        state.cache = cache;
        state.loading = false;
        els.loadStatus.textContent = "Ready";
        setProgress("Loaded from local cache.", 1, 1);
        return cache;
      }

      return MetadataStore.loadAll(state.session, updateFromProgress).then(function (fresh) {
        state.cache = fresh;
        state.loading = false;
        els.loadStatus.textContent = "Ready";
        return fresh;
      });
    }).then(function () {
      els.searchInput.disabled = false;
      renderCounts();
      applyInitialSelection();
      renderResults();
    }).catch(function (err) {
      state.loading = false;
      els.loadStatus.textContent = "Error";
      setProgress(err && err.message ? err.message : "Could not load metadata.", 0, 1);
    });
  }

  function applyInitialSelection() {
    var params = getParams();
    var type = params.get("type") || state.activeType;
    if (["dataExtension", "automation", "journey"].indexOf(type) === -1) type = "dataExtension";
    selectType(type);

    var selected = findObject(type, params.get("id"), params.get("key"));
    if (selected) {
      selectItem(selected, false);
    } else {
      state.selected = null;
      els.detailEmpty.classList.remove("hidden");
      els.detailContent.classList.add("hidden");
      els.detailContent.innerHTML = "";
    }
  }

  document.querySelectorAll(".nav-item").forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectType(btn.dataset.type);
      state.selected = null;
      els.detailEmpty.classList.remove("hidden");
      els.detailContent.classList.add("hidden");
      els.detailContent.innerHTML = "";
      history.replaceState(null, "", window.location.pathname);
    });
  });

  els.results.addEventListener("click", function (evt) {
    var btn = evt.target.closest && evt.target.closest(".result-item");
    if (!btn) return;
    var key = String(btn.dataset.key || "");
    var items = getTypeCollection(state.activeType);
    var selected = null;
    for (var i = 0; i < items.length; i++) {
      if (getObjectKey(items[i]) === key) {
        selected = items[i];
        break;
      }
    }
    if (selected) selectItem(selected);
  });

  els.searchInput.addEventListener("input", renderResults);

  els.detailContent.addEventListener("click", function (evt) {
    var btn = evt.target.closest && evt.target.closest(".native-open-link");
    if (!btn) return;
    openInSfmc({
      type: btn.dataset.nativeType || "",
      id: btn.dataset.nativeId || "",
      version: btn.dataset.nativeVersion || "",
      url: btn.dataset.url || ""
    });
  });

  els.btnOpenSqlSearch.addEventListener("click", function () {
    openExtensionPage("sql-search/sql-search.html");
  });

  els.btnOpenQueryEditor.addEventListener("click", function () {
    openExtensionPage("query-editor/query-editor.html");
  });

  els.btnRefresh.addEventListener("click", function () {
    if (!state.session || !state.session.isValid || state.loading) return;
    MetadataStore.clear().then(loadMetadata);
  });

  detectSession().then(function (session) {
    if (!updateSessionUI(session)) return;
    loadMetadata();
  });
})();
