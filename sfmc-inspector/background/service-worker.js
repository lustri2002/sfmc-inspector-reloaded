/**
 * SFMC Inspector Reloaded — Service Worker
 *
 * Authentication: SFMC exposes a /cloud/fuelapi/ proxy on the main domain
 * (mc.s51.exacttarget.com) that accepts REST API calls using the browser's
 * existing session cookies. No OAuth, no token exchange needed.
 * Discovered via reverse engineering of SFMC Companion extension.
 */

var session = {
  hostname:       null,
  stackKey:       null,
  businessUnitId: null,
  fuelBase:       null,   // https://mc.s51.exacttarget.com/cloud/fuelapi
  isValid:        false
};

var POPUP_CACHE_KEY = "sfmcInspectorPopupCache";
var SQL_SEARCH_CACHE_KEY = "sfmcInspectorSqlSearchCache";

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  switch (msg.type) {

    case "DETECT_SESSION":
      detectSession(msg.hostname)
        .then(function(s) { sendResponse({ ok: true,  session: s }); })
        .catch(function(e){ sendResponse({ ok: false, error: e.message }); });
      return true;

    case "GET_SESSION":
      sendResponse(getSessionStatus());
      break;

    case "SFMC_CONTEXT_CAPTURED":
      if (msg.context && msg.context.hostname) {
        detectSession(msg.context.hostname).catch(function(err) {
          console.warn("[SFMC Inspector Reloaded SW] Could not refresh captured SFMC context:", err.message);
        });
      }
      sendResponse({ ok: true });
      break;

    case "SFMC_API_CALL":
      handleApiCall(msg.payload)
        .then(function(result) { sendResponse({ ok: true, data: result }); })
        .catch(function(err)   { sendResponse({ ok: false, error: err.message }); });
      return true;

    case "OPEN_NATIVE_OBJECT":
      openNativeObject(msg.payload)
        .then(function(result) { sendResponse({ ok: true, data: result }); })
        .catch(function(err)   { sendResponse({ ok: false, error: err.message }); });
      return true;
  }
  return true;
});

// ── Session detection ─────────────────────────────────────────────────────────

var SESSION_PROBE_ENDPOINT = "/legacy/v1/beta/folder/0/children?$pageSize=1";

function parseJsonResponseText(text) {
  if (!text) return null;
  try { return JSON.parse(text); }
  catch(e) { return null; }
}

function formatApiError(result) {
  if (!result) return "No response";
  if (result.error) return result.error;
  var body = parseJsonResponseText(result.text);
  var statusPrefix = result.status ? ("HTTP " + result.status + ": ") : "";
  if (body && (body.message || body.error || body.error_description)) {
    return statusPrefix + (body.message || body.error || body.error_description);
  }
  return statusPrefix + (String(result.text || "").substring(0, 200) || "Empty response");
}

function findTabByHostname(hostname) {
  return chrome.tabs.query({}).then(function(tabs) {
    var sfmcTab = tabs.find(function(t) {
      return t.url && t.url.includes(hostname);
    });
    if (!sfmcTab) throw new Error("SFMC tab not found");
    return sfmcTab;
  });
}

function fetchFuelApiViaContentScript(tab, fuelBase, endpoint, method, body) {
  return new Promise(function(resolve, reject) {
    chrome.tabs.sendMessage(tab.id, {
      type:     "SFMC_IN_PAGE_FETCH",
      fuelBase: fuelBase,
      endpoint: endpoint,
      method:   method || "GET",
      body:     body || null
    }, function(response) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error(response ? response.error : "No response from SFMC tab"));
        return;
      }
      resolve(response.result);
    });
  });
}

function fetchFuelApiViaScripting(tab, fuelBase, endpoint, method, body) {
  return chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: function(fuelBase, endpoint, method, body) {
      var url = fuelBase + endpoint;
      var opts = {
        method:      method || "GET",
        credentials: "include",
        headers:     {}
      };
      if (body) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }

      return fetch(url, opts)
        .then(function(r) {
          return r.text().then(function(t) {
            return { status: r.status, text: t };
          });
        })
        .catch(function(e) { return { error: e.message }; });
    },
    args: [fuelBase, endpoint, method || "GET", body || null]
  }).then(function(results) {
    return results && results[0] && results[0].result;
  });
}

async function fetchFuelApiInSfmcTab(tab, fuelBase, endpoint, method, body) {
  try {
    return await fetchFuelApiViaContentScript(tab, fuelBase, endpoint, method, body);
  } catch(contentScriptError) {
    console.warn("[SFMC Inspector Reloaded SW] Content-script fetch failed, falling back to scripting:", contentScriptError.message);
    return fetchFuelApiViaScripting(tab, fuelBase, endpoint, method, body);
  }
}

async function detectSession(hostname) {
  if (!hostname) throw new Error("No hostname provided");

  var fuelBase = "https://" + hostname + "/cloud/fuelapi";

  // Probe with a lightweight call — get BU info
  var sfmcTab = await findTabByHostname(hostname);
  var result = await fetchFuelApiInSfmcTab(sfmcTab, fuelBase, SESSION_PROBE_ENDPOINT);
  var data = parseJsonResponseText(result && result.text);
  console.log("[SFMC Inspector Reloaded SW] Probe result:", JSON.stringify(result).substring(0, 200));

  if (!result || result.error || result.status >= 400) {
    throw new Error(formatApiError(result));
  }

  // Extract stack key from hostname: mc.s51.exacttarget.com → s51
  var stackMatch = hostname.match(/\.(s\d+)\./i);
  var previousSession = {
    hostname:       session.hostname,
    stackKey:       session.stackKey,
    fuelBase:       session.fuelBase,
    businessUnitId: session.businessUnitId,
    isValid:        session.isValid
  };

  session = {
    hostname:       hostname,
    stackKey:       stackMatch ? stackMatch[1] : null,
    fuelBase:       fuelBase,
    businessUnitId: (data && data.legacyId) || null,
    isValid:        result.status === 200
  };

  chrome.storage.session.set({ sfmcSession: session });

  if (hasSessionContextChanged(previousSession, session)) {
    await clearMetadataCaches();
    notifySessionContextChanged(previousSession, session);
  }

  console.log("[SFMC Inspector Reloaded SW] Session established:", JSON.stringify(getSessionStatus()));

  return getSessionStatus();
}

function getSessionCacheKey(s) {
  if (!s || !s.isValid) return "";
  return [
    s.hostname || "",
    s.businessUnitId || "",
    s.stackKey || ""
  ].join("|");
}

function hasSessionContextChanged(previousSession, nextSession) {
  var previousKey = getSessionCacheKey(previousSession);
  var nextKey = getSessionCacheKey(nextSession);
  return !!previousKey && !!nextKey && previousKey !== nextKey;
}

function clearMetadataCaches() {
  return new Promise(function(resolve) {
    if (!chrome.storage || !chrome.storage.local) {
      resolve();
      return;
    }
    chrome.storage.local.remove([POPUP_CACHE_KEY, SQL_SEARCH_CACHE_KEY], function() {
      if (chrome.runtime.lastError) {
        console.warn("[SFMC Inspector Reloaded SW] Could not clear metadata caches:", chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

function notifySessionContextChanged(previousSession, nextSession) {
  chrome.runtime.sendMessage({
    type: "SFMC_BU_CHANGED",
    previousBusinessUnitId: previousSession.businessUnitId || null,
    businessUnitId: nextSession.businessUnitId || null,
    session: getSessionStatus()
  }, function() {
    // Receiving contexts may not be open.
    void chrome.runtime.lastError;
  });
}

// ── API call — injected into SFMC tab to use session cookies ──────────────────

async function handleApiCall(payload) {
  if (!session.fuelBase) throw new Error("Session not established. Click Refresh.");

  var sfmcTab = await findTabByHostname(session.hostname);
  var result = await fetchFuelApiInSfmcTab(
    sfmcTab,
    session.fuelBase,
    payload.endpoint,
    payload.method || "GET",
    payload.body || null
  );
  if (!result || result.error) throw new Error(result ? result.error : "Script execution failed");
  if (result.status >= 400) throw new Error("API_ERROR " + result.status + ": " + result.text.substring(0, 200));

  try { return JSON.parse(result.text); }
  catch(e) { return { raw: result.text }; }
}

// ── Native UI navigation ─────────────────────────────────────────────────────

function wait(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

function getHostFromUrl(url) {
  try { return new URL(url).hostname; }
  catch(e) { return ""; }
}

async function findSfmcTab(fallbackUrl) {
  var hostname = session.hostname || getHostFromUrl(fallbackUrl);
  if (!hostname) throw new Error("Session not established. Click Refresh.");

  var tabs = await chrome.tabs.query({});
  var sfmcTab = tabs.find(function(t) {
    return t.url && t.url.includes(hostname);
  });
  if (!sfmcTab) throw new Error("SFMC tab not found. Keep the SFMC tab open.");
  return sfmcTab;
}

async function focusSfmcTab(tab, url) {
  var updatedTab = await chrome.tabs.update(tab.id, { url: url, active: true });
  if (tab.windowId != null && chrome.windows && chrome.windows.update) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return updatedTab || tab;
}

function getNativeNavigationConfig(payload) {
  var host = session.hostname || getHostFromUrl(payload.fallbackUrl);
  var fallbackUrl = payload.fallbackUrl || "";
  var objectId = payload.objectId || "";
  var version = payload.version || 1;

  if (payload.objectType === "dataExtension") {
    return {
      shellUrl: fallbackUrl || ("https://" + host + "/cloud/#app/Contact%20Builder"),
      frameNeedles: ["contactsmeta/admin.html"],
      targetPath: "/contactsmeta/admin.html#admin/data-extension/" + encodeURIComponent(objectId) + "/properties/",
      notFoundMessage: "Ho aperto Contact Builder, ma non ho trovato l'iframe contactsmeta da pilotare."
    };
  }

  if (payload.objectType === "automation") {
    return {
      shellUrl: fallbackUrl || ("https://" + host + "/cloud/#app/Automation%20Studio/AutomationStudioFuel3/"),
      usesFrameNavigation: false
    };
  }

  if (payload.objectType === "query") {
    return {
      shellUrl: fallbackUrl || ("https://" + host + "/cloud/#app/Automation%20Studio/AutomationStudioFuel3/"),
      usesFrameNavigation: false
    };
  }

  if (payload.objectType === "journey") {
    return {
      shellUrl: fallbackUrl || ("https://" + host + "/cloud/#app/Journey%20Builder/"),
      usesFrameNavigation: false
    };
  }

  throw new Error("Open in SFMC non disponibile per questo oggetto.");
}

async function navigateNativeFrame(tabId, config) {
  var lastFrames = [];

  for (var attempt = 0; attempt < 24; attempt++) {
    var results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        func: function(frameNeedles, targetPath) {
          function frameMatchesLocal(href, needles) {
            var lower = String(href || "").toLowerCase();
            return needles.some(function(needle) {
              return lower.indexOf(String(needle).toLowerCase()) !== -1;
            });
          }

          var href = window.location.href;
          if (!frameMatchesLocal(href, frameNeedles)) {
            return { matched: false, href: href };
          }

          var target = window.location.origin + targetPath;

          if (window.location.href !== target) {
            window.location.assign(target);
          }

          return { matched: true, href: href, target: target };
        },
        args: [config.frameNeedles, config.targetPath]
      });
    } catch(e) {
      results = [];
    }

    lastFrames = (results || []).map(function(r) {
      return r && r.result ? r.result : null;
    }).filter(Boolean);

    var match = lastFrames.find(function(frame) {
      return frame.matched;
    });
    if (match) return match;

    await wait(500);
  }

  throw new Error(config.notFoundMessage);
}

async function openNativeObject(payload) {
  payload = payload || {};
  if (!payload.objectId) {
    throw new Error("Object ID non disponibile per questo oggetto.");
  }

  var config = getNativeNavigationConfig(payload);
  var tab = await findSfmcTab(payload.fallbackUrl);
  var updatedTab = await focusSfmcTab(tab, config.shellUrl);

  if (!config.usesFrameNavigation) {
    return { matched: true, href: updatedTab.url || config.shellUrl, target: config.shellUrl };
  }

  await wait(1000);
  return navigateNativeFrame(updatedTab.id || tab.id, config);
}

// ── Session status ────────────────────────────────────────────────────────────

function getSessionStatus() {
  return {
    isValid:        session.isValid,
    hostname:       session.hostname,
    stackKey:       session.stackKey,
    fuelBase:       session.fuelBase,
    businessUnitId: session.businessUnitId,
    hasToken:       session.isValid
  };
}

chrome.storage.session.get("sfmcSession", function(result) {
  if (result.sfmcSession) session = result.sfmcSession;
});
