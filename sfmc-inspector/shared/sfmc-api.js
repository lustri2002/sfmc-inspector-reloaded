/**
 * SFMC Inspector — sfmc-api.js
 * All endpoints use the /cloud/fuelapi/ proxy on mc.s51.exacttarget.com
 * which accepts calls with session cookies — no Bearer token needed.
 * Endpoint patterns discovered from SFMC Companion (v0.4.2, Cameron Robert).
 */

var SfmcApi = (function () {

  function call(endpoint, method, body) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({
        type:    "SFMC_API_CALL",
        payload: { endpoint: endpoint, method: method || "GET", body: body || null }
      }, function (response) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response || !response.ok) return reject(new Error(response ? response.error : "No response"));
        resolve(response.data);
      });
    });
  }

  function getSession() {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: "GET_SESSION" }, function (resp) {
        resolve(resp || { isValid: false });
      });
    });
  }

  // ── Data Extensions ──────────────────────────────────────────────────────────

  function getDataExtensions(onProgress) {
    // SFMC requires a $search prefix — we query all alphanumeric prefixes in parallel
    // and deduplicate by customerKey
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789-_ ".split("");
    var base = "/data-internal/v1/customobjects?retrievalType=1&includeFullPath=true&$pageSize=500&$page=1&$search=";
    var completed = 0;
    var seenProgress = {};
    var uniqueCount = 0;
    var promises = chars.map(function(c) {
      return call(base + encodeURIComponent(c) + "%25").then(function(d) {
        return d.items || [];
      }).catch(function() { return []; }).then(function(items) {
        completed++;
        items.forEach(function(de) {
          var key = de.customerKey || de.key || de.objectId || de.name;
          if (key && !seenProgress[key]) {
            seenProgress[key] = true;
            uniqueCount++;
          }
        });
        if (onProgress) onProgress(completed, chars.length, uniqueCount);
        return items;
      });
    });
    return Promise.all(promises).then(function(results) {
      var seen = {};
      var all  = [];
      results.forEach(function(items) {
        items.forEach(function(de) {
          var key = de.customerKey || de.key || de.objectId || de.name;
          if (key && !seen[key]) {
            seen[key] = true;
            all.push(de);
          }
        });
      });
      all.sort(function(a, b) { return (a.name||"").localeCompare(b.name||""); });
      return { items: all, count: all.length };
    });
  }

  function getDataExtensionsByFolder(categoryId, page, pageSize) {
    var p = page || 1, ps = pageSize || 500;
    return call("/internal/v1/customobjects/category/" + (categoryId || 0) + "?orderBy=name%20asc&$pageSize=" + ps + "&$page=" + p);
  }

  function getDataExtensionsByCategory(categoryId) {
    return call("/internal/v1/customobjects/category/" + categoryId + "?orderBy=name%20asc&$pageSize=1000&$page=1");
  }

  function getDataExtensionFields(deKey) {
    return call("/data-internal/v1/customobjects/" + deKey + "/fields");
  }

  // ── Automations ───────────────────────────────────────────────────────────────

  function getAutomations(page, pageSize) {
    var ps = pageSize || 1000;
    var start = ((page || 1) - 1) * ps + 1;
    return call("/legacy/v1/beta/automations/automation/definition/?$sort=lastRunTime%20desc&view=gridView&$itemsPerPage=" + ps + "&$startIndex=" + start);
  }

  function getAutomationById(id) {
    // view=targetObjects returns steps → activities → targetObject (the target DE)
    return call("/automation/v1/automations/" + id + "?view=targetObjects");
  }

  // ── Query Activities ──────────────────────────────────────────────────────────

  function getQueryActivities(page, pageSize) {
    var p = page || 1, ps = pageSize || 1000;
    return call("/automation/v1/queries/?$orderBy=modifiedDate%20desc&retrievalType=1&$pageSize=" + ps + "&$page=" + p);
  }

  function getQueryActivityById(activityObjectId) {
    // Returns the full query definition including queryText (SQL)
    return call("/automation/v1/queries/" + activityObjectId);
  }

  // ── Journeys ──────────────────────────────────────────────────────────────────

  function getJourneys(page, pageSize) {
    var p = page || 1, ps = pageSize || 100;
    return call("/interaction/v1/interactions?$page=" + p + "&$pageSize=" + ps);
  }

  function getJourneyById(id) {
    return call("/interaction/v1/interactions/" + id);
  }

  // ── Folders ───────────────────────────────────────────────────────────────────

  function getFolders(categoryType) {
    if (categoryType) {
      return call("/automation/v1/folders/?$filter=categorytype%20eq%20" + categoryType);
    }
    return call("/legacy/v1/beta/folder/0/children");
  }

  // ── Assets ────────────────────────────────────────────────────────────────────

  function getAssets(page, pageSize) {
    var p = page || 1, ps = pageSize || 200;
    return call("/asset/v1/assets?scope=ours&$pageSize=" + ps + "&$page=" + p);
  }

  // ── SSJS Scripts ──────────────────────────────────────────────────────────────

  function getScripts(page, pageSize) {
    var p = page || 1, ps = pageSize || 1000;
    return call("/automation/v1/scripts/?$orderBy=modifiedDate%20desc&retrievalType=1&$pageSize=" + ps + "&$page=" + p);
  }

  // ── Event Definitions (Journey entry sources) ─────────────────────────────────

  function getEventDefinitions() {
    return call("/interaction/v1/eventDefinitions?$sort=createdDate%20desc&$pageSize=1000&$page=1");
  }

  return {
    call:                     call,
    getSession:               getSession,
    getDataExtensions:        getDataExtensions,
    getDataExtensionsByFolder: getDataExtensionsByFolder,
    getDataExtensionFields:   getDataExtensionFields,
    getAutomations:           getAutomations,
    getAutomationById:        getAutomationById,
    getQueryActivities:       getQueryActivities,
    getQueryActivityById:     getQueryActivityById,
    getJourneys:              getJourneys,
    getJourneyById:           getJourneyById,
    getFolders:               getFolders,
    getAssets:                getAssets,
    getScripts:               getScripts,
    getEventDefinitions:      getEventDefinitions
  };

})();
