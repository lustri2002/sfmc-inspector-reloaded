/**
 * SFMC Inspector Reloaded - SQL Search dedicated page.
 * Long-running Query Activity indexing belongs here instead of the popup.
 */

(function () {
  "use strict";

  var CACHE_KEY = "sfmcInspectorSqlSearchCache";
  var CACHE_VERSION = 1;

  var state = {
    session: null,
    indexing: false,
    queries: [],
    automations: [],
    automationDetailsById: {},
    automationMatchesByQueryId: {},
    scannedAt: null
  };

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    sessionBadge: $("session-badge"),
    sessionLabel: $("session-label"),
    sessionHost: $("session-host"),
    cacheLabel: $("cache-label"),
    queryTotal: $("query-total"),
    automationTotal: $("automation-total"),
    usageTotal: $("usage-total"),
    progressBar: $("progress-bar"),
    progressLabel: $("progress-label"),
    btnRescan: $("btn-rescan"),
    btnClear: $("btn-clear"),
    btnOpenMetadata: $("btn-open-metadata"),
    btnOpenQueryEditor: $("btn-open-query-editor"),
    searchInput: $("search-input"),
    scopeFilters: Array.prototype.slice.call(document.querySelectorAll(".scope-filter")),
    onlyUsedFilter: $("only-used-filter"),
    resultCount: $("result-count"),
    stateMessage: $("state-message"),
    results: $("results")
  };

  if (window.FeatureFlags) FeatureFlags.applyVisibility(document);

  function hasChromeStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function hasChromeTabs() {
    return typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query;
  }

  function hasChromeRuntime() {
    return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;
  }

  function openExtensionPage(path) {
    if (window.FeatureFlags && !FeatureFlags.canOpenPath(path)) return;
    if (!hasChromeRuntime() || !chrome.tabs || !chrome.tabs.create) return;
    chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  }

  if (hasChromeStorage() && chrome.storage.local.setAccessLevel) {
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }, function () {
      if (chrome.runtime.lastError) {
        console.warn("[SFMC Inspector Reloaded SQL Search] Could not restrict local storage access:", chrome.runtime.lastError.message);
      }
    });
  }

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
        month: "short", day: "numeric", year: "numeric"
      });
    } catch (e) {
      return date;
    }
  }

  function statusTag(status) {
    if (!status) return "";
    var s = String(status).toLowerCase();
    var cls = s === "active" || s === "running" || s === "published"
      ? "green" : s === "paused" || s === "draft"
      ? "yellow" : s === "error" || s === "stopped"
      ? "red" : "blue";
    return '<span class="tag tag--' + cls + '">' + escHtml(status) + "</span>";
  }

  function highlight(text, query) {
    if (!query || !text) return escHtml(text);
    var re = new RegExp("(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    return escHtml(text).replace(re, '<span class="hl">$1</span>');
  }

  function highlightPlainToken(text, query) {
    if (!query || !text) return escHtml(text);

    var re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    var result = "";
    var lastIndex = 0;
    String(text).replace(re, function (match, offset) {
      result += escHtml(String(text).slice(lastIndex, offset));
      result += '<span class="hl">' + escHtml(match) + "</span>";
      lastIndex = offset + match.length;
      return match;
    });
    result += escHtml(String(text).slice(lastIndex));
    return result;
  }

  var SQL_KEYWORDS = {
    add: true, all: true, alter: true, and: true, any: true, as: true, asc: true,
    between: true, by: true, case: true, cast: true, coalesce: true, convert: true,
    create: true, cross: true, delete: true, desc: true, distinct: true, drop: true,
    else: true, end: true, except: true, exists: true, from: true, full: true,
    group: true, having: true, in: true, inner: true, insert: true, intersect: true,
    into: true, is: true, join: true, left: true, like: true, not: true, null: true,
    on: true, or: true, order: true, outer: true, over: true, partition: true,
    right: true, row_number: true, select: true, set: true, then: true, top: true,
    union: true, update: true, values: true, when: true, where: true, with: true
  };

  function renderSqlToken(token, cls, query) {
    return '<span class="' + cls + '">' + highlightPlainToken(token, query) + "</span>";
  }

  function syntaxHighlightSql(sql, query) {
    if (!sql) return "";

    var text = String(sql);
    var tokenRe = /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:[^"]|"")*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|[\s\S])/g;
    var out = "";
    var match;

    while ((match = tokenRe.exec(text)) !== null) {
      var token = match[0];
      var nextChar = text.slice(tokenRe.lastIndex).match(/^\s*(.)/);

      if (token.indexOf("--") === 0 || token.indexOf("/*") === 0) {
        out += renderSqlToken(token, "sql-comment", query);
      } else if (token.charAt(0) === "'" || token.charAt(0) === '"') {
        out += renderSqlToken(token, "sql-string", query);
      } else if (/^\d/.test(token)) {
        out += renderSqlToken(token, "sql-number", query);
      } else if (/^[A-Za-z_]/.test(token)) {
        var lower = token.toLowerCase();
        if (SQL_KEYWORDS[lower]) {
          out += renderSqlToken(token, "sql-keyword", query);
        } else if (nextChar && nextChar[1] === "(") {
          out += renderSqlToken(token, "sql-function", query);
        } else {
          out += highlightPlainToken(token, query);
        }
      } else {
        out += highlightPlainToken(token, query);
      }
    }

    return out;
  }

  function getSessionCacheKey(session) {
    if (!session || !session.isValid) return "";
    return [
      session.hostname || "",
      session.businessUnitId || "",
      session.stackKey || ""
    ].join("|");
  }

  function setProgress(label, loaded, total) {
    els.progressLabel.textContent = label;
    if (!total) {
      els.progressBar.style.width = state.indexing ? "18%" : "0%";
      return;
    }
    var pct = Math.max(2, Math.min(100, Math.round((loaded / total) * 100)));
    els.progressBar.style.width = pct + "%";
  }

  function updateSessionUI(session) {
    state.session = session;
    if (session && session.isValid && session.hasToken) {
      els.sessionBadge.className = "badge badge--connected";
      els.sessionLabel.textContent = "Connected";
      els.sessionHost.textContent = session.hostname || session.subdomain || "SFMC";
      return;
    }

    els.sessionBadge.className = "badge badge--error";
    els.sessionLabel.textContent = "No session";
    els.sessionHost.textContent = "Open Marketing Cloud in another tab";
  }

  function readCache() {
    return new Promise(function (resolve) {
      if (!hasChromeStorage()) {
        resolve(null);
        return;
      }
      chrome.storage.local.get(CACHE_KEY, function (result) {
        resolve(result && result[CACHE_KEY] ? result[CACHE_KEY] : null);
      });
    });
  }

  function saveCache() {
    if (!state.session || !state.session.isValid || !hasChromeStorage()) return;
    var payload = {};
    payload[CACHE_KEY] = {
      version: CACHE_VERSION,
      sessionKey: getSessionCacheKey(state.session),
      updatedAt: Date.now(),
      queries: state.queries,
      automations: state.automations,
      automationMatchesByQueryId: state.automationMatchesByQueryId,
      scannedAt: state.scannedAt
    };
    chrome.storage.local.set(payload, function () {
      if (chrome.runtime.lastError) {
        console.warn("[SFMC Inspector Reloaded SQL Search] Could not save cache:", chrome.runtime.lastError.message);
      }
    });
  }

  function clearCache() {
    return new Promise(function (resolve) {
      state.queries = [];
      state.automations = [];
      state.automationDetailsById = {};
      state.automationMatchesByQueryId = {};
      state.scannedAt = null;
      if (!hasChromeStorage()) {
        resolve();
        return;
      }
      chrome.storage.local.remove(CACHE_KEY, resolve);
    });
  }

  function restoreCache() {
    return readCache().then(function (cache) {
      if (!cache ||
          cache.version !== CACHE_VERSION ||
          cache.sessionKey !== getSessionCacheKey(state.session)) {
        return false;
      }

      state.queries = Array.isArray(cache.queries) ? cache.queries : [];
      state.automations = Array.isArray(cache.automations) ? cache.automations : [];
      state.automationMatchesByQueryId = cache.automationMatchesByQueryId || {};
      state.scannedAt = cache.scannedAt || cache.updatedAt || null;
      updateSummary();
      renderResults();
      setProgress("Index loaded from local cache.", 1, 1);
      els.searchInput.disabled = false;
      return true;
    });
  }

  function updateSummary() {
    var usageCount = Object.keys(state.automationMatchesByQueryId || {}).reduce(function (sum, key) {
      return sum + (state.automationMatchesByQueryId[key] || []).length;
    }, 0);

    els.queryTotal.textContent = state.queries.length || "-";
    els.automationTotal.textContent = state.automations.length || "-";
    els.usageTotal.textContent = usageCount || "-";
    els.cacheLabel.textContent = state.scannedAt ? "Updated " + fmt(state.scannedAt) : "No cache";
  }

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
      id: a.id || a.automationId || "",
      name: a.name || "-",
      key: a.key || a.customerKey || "",
      status: a.status || "-",
      schedule: a.schedule ? (a.schedule.scheduleTypeId === 1 ? "Scheduled" : "Triggered") : "-",
      lastRunTime: a.lastRunTime || null
    };
  }

  function loadAutomationPages(page, pageSize, acc, knownTotal) {
    return SfmcApi.getAutomations(page, pageSize).then(function (data) {
      var pageItems = getAutomationItems(data);
      var total = getAutomationTotal(data) || knownTotal;
      acc = acc.concat(pageItems);

      setProgress(total
        ? "Loading automations " + acc.length + " / " + total + "..."
        : "Loading automations " + acc.length + "...", acc.length, total || Math.max(acc.length + pageSize, 1));

      if ((total && acc.length >= total) || pageItems.length < pageSize || page >= 200) {
        return { items: acc, total: total || acc.length };
      }

      return loadAutomationPages(page + 1, pageSize, acc, total);
    });
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

  function buildAutomationMatches(rawAutomations) {
    state.automationMatchesByQueryId = {};
    state.automationDetailsById = {};

    return mapWithConcurrency(rawAutomations, 4, function (auto) {
      return getAutomationDetailCached(auto).then(function (detail) {
        if (!detail || !detail.steps) return null;

        detail.steps.forEach(function (step, stepIndex) {
          if (!step.activities) return;
          step.activities.forEach(function (act) {
            if (act.objectTypeId !== 300) return;

            var queryId = getAutomationActivityQueryId(act);
            var mapKey = getQueryAutomationKey(queryId);
            if (!mapKey) return;

            if (!state.automationMatchesByQueryId[mapKey]) {
              state.automationMatchesByQueryId[mapKey] = [];
            }

            state.automationMatchesByQueryId[mapKey].push({
              automationId: detail.id || auto.id || auto.automationId || "",
              automationKey: detail.key || auto.key || auto.customerKey || "",
              automationName: detail.name || auto.name || "-",
              status: detail.status || auto.status || "-",
              activityName: act.name || "Query Activity",
              stepName: step.name || ("Step " + (stepIndex + 1))
            });
          });
        });
        return null;
      });
    }, function (done, total) {
      setProgress("Mapping automations " + done + " / " + total + "...", done, total);
    }).then(function () {
      Object.keys(state.automationMatchesByQueryId).forEach(function (queryId) {
        var seen = {};
        state.automationMatchesByQueryId[queryId] =
          state.automationMatchesByQueryId[queryId].filter(function (match) {
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
    });
  }

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
    var targetObject = src.targetObject || src.targetDataExtension || src.dataExtension || {};

    return {
      id: getQueryActivityId(src) || getQueryActivityId(summary) || getQueryActivityId(detail) || "",
      name: src.name || src.queryName || src.activityName || "-",
      key: src.key || src.customerKey || src.queryDefinitionKey || src.objectId || "",
      targetName: src.targetName || src.targetObjectName || src.dataExtensionName || src.targetDataExtensionName || targetObject.name || "",
      targetKey: src.targetKey || src.targetObjectKey || src.dataExtensionCustomerKey || src.targetDataExtensionKey || targetObject.key || targetObject.customerKey || "",
      queryText: getQueryTextFromPayload(src) || "",
      createdDate: src.createdDate || src.CreatedDate || null,
      modifiedDate: src.modifiedDate || src.ModifiedDate || null
    };
  }

  function loadQueryActivityPages(page, pageSize, acc, knownTotal) {
    return SfmcApi.getQueryActivities(page, pageSize).then(function (data) {
      var pageItems = getQueryActivityItems(data);
      var total = getQueryActivityTotal(data) || knownTotal;
      acc = acc.concat(pageItems);

      setProgress(total
        ? "Loading Query Activities " + acc.length + " / " + total + "..."
        : "Loading Query Activities " + acc.length + "...", acc.length, total || Math.max(acc.length + pageSize, 1));

      if ((total && acc.length >= total) || pageItems.length < pageSize || page >= 200) {
        return { items: acc, total: total || acc.length };
      }

      return loadQueryActivityPages(page + 1, pageSize, acc, total);
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
        .catch(function () {
          return seed;
        });
    }, function (done, total) {
      setProgress("Indexing SQL " + done + " / " + total + "...", done, total);
    });
  }

  function indexAll() {
    if (!state.session || !state.session.isValid || state.indexing) return;

    state.indexing = true;
    state.queries = [];
    state.automations = [];
    state.automationDetailsById = {};
    state.automationMatchesByQueryId = {};
    els.searchInput.disabled = true;
    els.btnRescan.disabled = true;
    els.stateMessage.classList.remove("hidden");
    els.stateMessage.textContent = "Indexing Query Activities and automation usage. You can keep this tab open and continue working in SFMC.";
    setProgress("Starting index...", 0, 1);
    updateSummary();
    renderResults();

    var rawAutomations = [];

    loadAutomationPages(1, 500, [], null)
      .then(function (result) {
        rawAutomations = result.items;
        var seen = {};
        state.automations = rawAutomations.filter(function (auto) {
          var key = String(auto.id || auto.automationId || auto.key || auto.name || "").toLowerCase();
          if (!key) return true;
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        }).map(normalizeAutomationSummary);
        updateSummary();
        return buildAutomationMatches(rawAutomations);
      })
      .then(function () {
        updateSummary();
        return loadQueryActivityPages(1, 250, [], null);
      })
      .then(function (result) {
        return hydrateQueryActivities(result.items);
      })
      .then(function (items) {
        var seen = {};
        state.queries = items.filter(Boolean).filter(function (item) {
          var key = String(item.id || item.key || item.name || "").toLowerCase();
          if (!key) return true;
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        }).sort(function (a, b) {
          return (a.name || "").localeCompare(b.name || "");
        });

        state.scannedAt = Date.now();
        state.indexing = false;
        els.searchInput.disabled = false;
        els.btnRescan.disabled = false;
        els.stateMessage.classList.add("hidden");
        setProgress("Index complete.", 1, 1);
        updateSummary();
        renderResults();
        saveCache();
      })
      .catch(function (err) {
        state.indexing = false;
        els.btnRescan.disabled = false;
        setProgress("Index failed.", 0, 1);
        els.stateMessage.classList.remove("hidden");
        els.stateMessage.textContent = err && err.message ? err.message : "Could not complete index.";
      });
  }

  function getAutomationMatchesForQuery(item) {
    if (!item) return [];
    var keys = [
      item.id,
      item.key
    ].map(getQueryAutomationKey).filter(Boolean);

    for (var i = 0; i < keys.length; i++) {
      var matches = state.automationMatchesByQueryId[keys[i]];
      if (matches && matches.length) return matches;
    }
    return [];
  }

  function getSelectedScopes() {
    var scopes = els.scopeFilters.filter(function (input) {
      return input.checked;
    }).map(function (input) {
      return input.value;
    });

    if (scopes.length === 0) {
      scopes = ["queryText"];
    }
    return scopes;
  }

  function handleFilterChange(event) {
    if (event && event.target && event.target.classList.contains("scope-filter")) {
      var selected = els.scopeFilters.filter(function (input) {
        return input.checked;
      });
      if (selected.length === 0) {
        event.target.checked = true;
      }
    }
    renderResults();
  }

  function getSearchText(item, scopes) {
    var automationText = getAutomationMatchesForQuery(item).map(function (match) {
      return [
        match.automationName,
        match.automationKey
      ].join(" ");
    }).join("\n");

    var parts = [];
    if (scopes.indexOf("queryText") !== -1) {
      parts.push(item.queryText);
    }
    if (scopes.indexOf("targetDe") !== -1) {
      parts.push(item.targetName, item.targetKey);
    }
    if (scopes.indexOf("activityName") !== -1) {
      parts.push(item.name, item.key);
    }
    if (scopes.indexOf("automationName") !== -1) {
      parts.push(automationText);
    }

    return parts.join("\n").toLowerCase();
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
    var start = idx >= 0 ? Math.max(0, idx - 170) : 0;
    var end = idx >= 0 ? Math.min(text.length, idx + q.length + 500) : Math.min(text.length, 850);
    var snippet = text.substring(start, end);
    if (start > 0) snippet = "...\n" + snippet;
    if (end < text.length) snippet += "\n...";
    return syntaxHighlightSql(snippet, query);
  }

  function renderAutomationUsage(matches) {
    if (!matches || matches.length === 0) {
      return '<div class="automation-list"><span class="tag">No automation usage found</span></div>';
    }

    var visible = matches.slice(0, 8);
    return '<div class="automation-list">' +
      visible.map(function (match) {
        return '<span class="automation-pill" title="' + escHtml(match.activityName || "") + '">' +
          '<span class="automation-name">' + escHtml(match.automationName) + "</span>" +
          statusTag(match.status) +
        "</span>";
      }).join("") +
      (matches.length > visible.length ? '<span class="tag">+' + (matches.length - visible.length) + " more</span>" : "") +
    "</div>";
  }

  function renderResults() {
    var q = els.searchInput.value.trim().toLowerCase();
    var selectedScopes = getSelectedScopes();
    var onlyUsed = els.onlyUsedFilter.checked;

    if (!state.queries.length) {
      els.results.innerHTML = '<div class="empty">No SQL index loaded yet.</div>';
      els.resultCount.textContent = "-";
      return;
    }

    var filtered = state.queries.filter(function (item) {
      var matches = getAutomationMatchesForQuery(item);
      if (onlyUsed && matches.length === 0) return false;
      if (!q) return true;
      return getSearchText(item, selectedScopes).includes(q);
    });

    els.resultCount.textContent = filtered.length + " result" + (filtered.length !== 1 ? "s" : "");

    if (filtered.length === 0) {
      els.results.innerHTML = '<div class="empty">No Query Activities matched your search.</div>';
      return;
    }

    var visible = filtered.slice(0, 300);
    els.results.innerHTML = visible.map(function (item) {
      var matches = getAutomationMatchesForQuery(item);
      var occurrenceCount = q ? countOccurrences(item.queryText, q) : 0;
      var meta = [
        matches.length + " automation" + (matches.length !== 1 ? "s" : ""),
        item.modifiedDate ? "Modified " + fmt(item.modifiedDate) : "",
        item.targetName ? "Target " + item.targetName : ""
      ].filter(Boolean).join(" | ");

      return '<article class="result-card">' +
        '<div class="result-header">' +
          '<div>' +
            '<div class="result-name">' + highlight(item.name, q) + "</div>" +
            '<div class="result-meta">' + highlight(meta, q) + "</div>" +
          "</div>" +
          '<div class="tag-row">' +
            (occurrenceCount ? '<span class="tag tag--blue">' + occurrenceCount + " hit" + (occurrenceCount !== 1 ? "s" : "") + "</span>" : "") +
            (item.key ? '<span class="tag">' + highlight(item.key, q) + "</span>" : "") +
          "</div>" +
        "</div>" +
        renderAutomationUsage(matches) +
        (item.queryText ? '<pre class="sql-snippet">' + buildSqlSnippet(item.queryText, q) + "</pre>" : '<div class="empty">SQL text not available.</div>') +
      "</article>";
    }).join("") +
    (filtered.length > visible.length ? '<div class="empty">Showing first ' + visible.length + " of " + filtered.length + " results. Narrow the search to see more.</div>" : "");
  }

  function loadSession() {
    updateSessionUI(null);
    SfmcApi.getSession().then(function (session) {
      if (session && session.isValid) {
        updateSessionUI(session);
        restoreCache().then(function (restored) {
          if (!restored) indexAll();
        });
        return;
      }

      if (!hasChromeTabs() || !hasChromeRuntime()) {
        updateSessionUI(null);
        els.stateMessage.textContent = "Extension runtime is not available in this preview. Load the extension to detect an SFMC session.";
        return;
      }

      chrome.tabs.query({}, function (allTabs) {
        var sfmcTab = null;
        for (var i = 0; i < allTabs.length; i++) {
          var u = allTabs[i].url || "";
          if (u.includes("exacttarget.com") || u.includes("marketingcloud.com")) {
            sfmcTab = allTabs[i];
            break;
          }
        }

        if (!sfmcTab) {
          updateSessionUI(null);
          els.stateMessage.textContent = "Open Salesforce Marketing Cloud in another tab, then click Rescan.";
          return;
        }

        var hostname = sfmcTab.url.match(/https?:\/\/([^/]+)/);
        if (!hostname) {
          updateSessionUI(null);
          return;
        }

        chrome.runtime.sendMessage({ type: "DETECT_SESSION", hostname: hostname[1] }, function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.ok || !resp.session) {
            updateSessionUI(null);
            els.stateMessage.textContent = chrome.runtime.lastError
              ? chrome.runtime.lastError.message
              : "Could not detect SFMC session.";
            return;
          }

          updateSessionUI(resp.session);
          restoreCache().then(function (restored) {
            if (!restored) indexAll();
          });
        });
      });
    });
  }

  els.btnRescan.addEventListener("click", function () {
    if (!state.session || !state.session.isValid) {
      loadSession();
      return;
    }
    indexAll();
  });

  els.btnClear.addEventListener("click", function () {
    clearCache().then(function () {
      els.searchInput.value = "";
      els.searchInput.disabled = true;
      setProgress("Cache cleared.", 0, 1);
      updateSummary();
      renderResults();
    });
  });

  els.btnOpenMetadata.addEventListener("click", function () {
    openExtensionPage("metadata-explorer/metadata-explorer.html");
  });

  els.btnOpenQueryEditor.addEventListener("click", function () {
    openExtensionPage("query-editor/query-editor.html");
  });

  els.searchInput.addEventListener("input", renderResults);
  els.scopeFilters.forEach(function (input) {
    input.addEventListener("input", handleFilterChange);
    input.addEventListener("change", handleFilterChange);
  });
  els.onlyUsedFilter.addEventListener("input", handleFilterChange);
  els.onlyUsedFilter.addEventListener("change", handleFilterChange);

  loadSession();
})();
