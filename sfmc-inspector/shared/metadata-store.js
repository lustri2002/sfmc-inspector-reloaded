/**
 * SFMC Inspector Reloaded - shared metadata cache/index.
 * Stores lightweight summaries for popup search and the Metadata Explorer.
 */

var MetadataStore = (function () {
  "use strict";

  var CACHE_KEY = "sfmcInspectorMetadataCache";
  var CACHE_VERSION = 2;
  var CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function hasStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  if (hasStorage() && chrome.storage.local.setAccessLevel) {
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }, function () {
      if (chrome.runtime.lastError) {
        console.warn("[SFMC Inspector Reloaded Metadata] Could not restrict local storage access:", chrome.runtime.lastError.message);
      }
    });
  }

  function getSessionCacheKey(session) {
    if (!session || !session.isValid) return "";
    return [
      session.hostname || "",
      session.businessUnitId || "",
      session.stackKey || ""
    ].join("|");
  }

  function isExpired(cache) {
    var updatedAt = cache && Number(cache.updatedAt);
    return !updatedAt || Date.now() - updatedAt > CACHE_MAX_AGE_MS;
  }

  function read(session) {
    return new Promise(function (resolve) {
      if (!hasStorage()) {
        resolve(null);
        return;
      }

      chrome.storage.local.get(CACHE_KEY, function (result) {
        var cache = result && result[CACHE_KEY] ? result[CACHE_KEY] : null;
        if (!cache ||
            cache.version !== CACHE_VERSION ||
            cache.sessionKey !== getSessionCacheKey(session) ||
            isExpired(cache)) {
          resolve(null);
          return;
        }
        resolve(cache);
      });
    });
  }

  function write(session, data) {
    return new Promise(function (resolve) {
      if (!session || !session.isValid || !hasStorage()) {
        resolve();
        return;
      }

      var payload = {};
      payload[CACHE_KEY] = Object.assign({
        version: CACHE_VERSION,
        sessionKey: getSessionCacheKey(session),
        updatedAt: Date.now()
      }, data || {});

      chrome.storage.local.set(payload, function () {
        if (chrome.runtime.lastError) {
          console.warn("[SFMC Inspector Reloaded Metadata] Could not save cache:", chrome.runtime.lastError.message);
        }
        resolve(payload[CACHE_KEY]);
      });
    });
  }

  function clear() {
    return new Promise(function (resolve) {
      if (!hasStorage()) {
        resolve();
        return;
      }
      chrome.storage.local.remove(CACHE_KEY, resolve);
    });
  }

  function isComplete(cache) {
    return !!(cache &&
      cache.complete === true &&
      cache.de && cache.de.loaded &&
      cache.automations && cache.automations.loaded &&
      cache.journeys && cache.journeys.loaded);
  }

  function formatPathValue(value) {
    if (!value) return "";
    return String(value).replace(/\\/g, " / ");
  }

  function getDataExtensionPath(de) {
    return formatPathValue(de.categoryFullPath || de.path || "");
  }

  function normalizeDataExtension(de) {
    de = de || {};
    return {
      type: "dataExtension",
      id: de.objectId || de.ObjectID || de.dataExtensionId || de.DataExtensionID || de.id || de.ID || "",
      name: de.name || de.Name || "-",
      key: de.customerKey || de.CustomerKey || de.key || de.externalKey || "",
      customerKey: de.customerKey || de.CustomerKey || de.key || de.externalKey || "",
      rowCount: de.rowCount != null ? de.rowCount : null,
      isSendable: !!(de.isSendable || de.IsSendable),
      isTestable: !!(de.isTestable || de.IsTestable),
      createdDate: de.createdDate || de.CreatedDate || null,
      modifiedDate: de.modifiedDate || de.ModifiedDate || null,
      categoryId: de.categoryId || de.CategoryID || null,
      path: getDataExtensionPath(de)
    };
  }

  function getAutomationItems(data) {
    var items = data && (data.entry || data.items || data.automations || data);
    return Array.isArray(items) ? items : [];
  }

  function getAutomationTotal(data) {
    if (!data) return null;
    return data.totalResults || data.totalCount || data.total || null;
  }

  function normalizeAutomation(auto) {
    auto = auto || {};
    return {
      type: "automation",
      id: auto.id || auto.automationId || "",
      name: auto.name || "-",
      key: auto.key || auto.customerKey || "",
      status: auto.status || "-",
      schedule: auto.schedule ? (auto.schedule.scheduleTypeId === 1 ? "Scheduled" : "Triggered") : "-",
      lastRunTime: auto.lastRunTime || null
    };
  }

  function getJourneyItems(data) {
    var items = data && (data.items || data.interactions || data.entry || data);
    return Array.isArray(items) ? items : [];
  }

  function getJourneyTotal(data) {
    if (!data) return null;
    return data.count || data.totalCount || data.totalResults || data.total || null;
  }

  function normalizeJourney(journey) {
    journey = journey || {};
    return {
      type: "journey",
      id: journey.id || "",
      key: journey.key || journey.eventDefinitionKey || "",
      url: journey.url || journey.link || journey.nativeUrl || "",
      name: journey.name || "-",
      status: journey.status || "-",
      version: journey.version || journey.versionNumber || 1,
      activityCount: journey.activities ? journey.activities.length : 0,
      createdDate: journey.createdDate || null,
      modifiedDate: journey.modifiedDate || null
    };
  }

  function dedupe(items, getKey) {
    var seen = {};
    return (items || []).filter(function (item) {
      var key = String(getKey(item) || "").toLowerCase();
      if (!key) return true;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
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

  function emitProgress(onProgress, section, payload) {
    if (onProgress) onProgress(Object.assign({ section: section }, payload || {}));
  }

  function loadDataExtensionIndex(loaded, onProgress) {
    return SfmcApi.getDataExtensions(function (done, total, uniqueCount) {
      emitProgress(onProgress, "de", {
        status: "loading",
        loaded: done,
        total: total,
        count: uniqueCount || 0,
        label: done + " / " + total + " prefixes"
      });
    }).then(function (data) {
      var raw = data.items || [];
      loaded.raw.de = raw;
      loaded.de.items = dedupe(raw.map(normalizeDataExtension), function (de) {
        return de.customerKey || de.id || de.name;
      }).sort(function (a, b) {
        return (a.name || "").localeCompare(b.name || "");
      });
      loaded.de.loaded = true;
      emitProgress(onProgress, "de", {
        status: "done",
        count: loaded.de.items.length,
        label: loaded.de.items.length + " Data Extensions"
      });
    }).catch(function (err) {
      loaded.de.error = err && err.message ? err.message : "Could not load Data Extensions";
      emitProgress(onProgress, "de", { status: "error", label: loaded.de.error });
    });
  }

  function loadAutomationIndex(loaded, onProgress) {
    return loadAutomationPages(1, 500, [], null, function (count, total) {
      emitProgress(onProgress, "automations", {
        status: "loading",
        loaded: count,
        total: total,
        label: total ? count + " / " + total + " automations" : "Loading " + count + " automations"
      });
    }).then(function (result) {
      loaded.raw.automations = dedupe(result.items || [], function (auto) {
        return auto.id || auto.automationId || auto.key || auto.name;
      });
      loaded.automations.items = loaded.raw.automations.map(normalizeAutomation).sort(function (a, b) {
        return (a.name || "").localeCompare(b.name || "");
      });
      loaded.automations.loaded = true;
      emitProgress(onProgress, "automations", {
        status: "done",
        count: loaded.automations.items.length,
        label: loaded.automations.items.length + " Automations"
      });
    }).catch(function (err) {
      loaded.automations.error = err && err.message ? err.message : "Could not load Automations";
      emitProgress(onProgress, "automations", { status: "error", label: loaded.automations.error });
    });
  }

  function loadJourneyIndex(loaded, onProgress) {
    return loadJourneyPages(1, 100, [], null, function (count, total) {
      emitProgress(onProgress, "journeys", {
        status: "loading",
        loaded: count,
        total: total,
        label: total ? count + " / " + total + " journeys" : "Loading " + count + " journeys"
      });
    }).then(function (result) {
      loaded.raw.journeys = result.items || [];
      loaded.journeys.items = loaded.raw.journeys.map(normalizeJourney).sort(function (a, b) {
        return (a.name || "").localeCompare(b.name || "");
      });
      loaded.journeys.loaded = true;
      emitProgress(onProgress, "journeys", {
        status: "done",
        count: loaded.journeys.items.length,
        label: loaded.journeys.items.length + " Journeys"
      });
    }).catch(function (err) {
      loaded.journeys.error = err && err.message ? err.message : "Could not load Journeys";
      emitProgress(onProgress, "journeys", { status: "error", label: loaded.journeys.error });
    });
  }

  function loadAll(session, onProgress) {
    var loaded = {
      de: { items: [], loaded: false, error: "" },
      automations: { items: [], loaded: false, error: "" },
      journeys: { items: [], loaded: false, error: "" },
      raw: { de: [], automations: [], journeys: [] },
      complete: false
    };

    emitProgress(onProgress, "all", { status: "loading", label: "Loading metadata..." });

    return Promise.allSettled([
      loadDataExtensionIndex(loaded, onProgress),
      loadAutomationIndex(loaded, onProgress),
      loadJourneyIndex(loaded, onProgress)
    ]).then(function () {
      loaded.complete = loaded.de.loaded && loaded.automations.loaded && loaded.journeys.loaded;
      emitProgress(onProgress, "all", {
        status: loaded.complete ? "done" : "partial",
        label: loaded.complete ? "Metadata ready" : "Metadata partially loaded"
      });
      return write(session, loaded);
    });
  }

  return {
    CACHE_KEY: CACHE_KEY,
    CACHE_MAX_AGE_MS: CACHE_MAX_AGE_MS,
    getSessionCacheKey: getSessionCacheKey,
    read: read,
    write: write,
    clear: clear,
    isExpired: isExpired,
    isComplete: isComplete,
    loadAll: loadAll,
    normalizeDataExtension: normalizeDataExtension,
    normalizeAutomation: normalizeAutomation,
    normalizeJourney: normalizeJourney,
    loadAutomationPages: loadAutomationPages,
    loadJourneyPages: loadJourneyPages
  };
})();
