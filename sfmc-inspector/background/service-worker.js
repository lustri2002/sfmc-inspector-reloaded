/**
 * SFMC Inspector Reloaded - Service Worker
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

async function detectSession(hostname) {
  if (!hostname) throw new Error("No hostname provided");

  var fuelBase = "https://" + hostname + "/cloud/fuelapi";

  // Probe with a lightweight call — get BU info
  var tabs = await chrome.tabs.query({});
  var sfmcTab = tabs.find(function(t) {
    return t.url && t.url.includes(hostname);
  });
  if (!sfmcTab) throw new Error("SFMC tab not found");

  // Use scripting to make the probe call from within the tab (uses session cookies)
  var results = await chrome.scripting.executeScript({
    target: { tabId: sfmcTab.id },
    func: function(fuelBase) {
      return fetch(fuelBase + "/legacy/v1/beta/folder/0/children?$pageSize=1", {
        credentials: "include"
      })
      .then(function(r) { return r.json().then(function(d) { return { status: r.status, data: d }; }); })
      .catch(function(e) { return { error: e.message }; });
    },
    args: [fuelBase]
  });

  var result = results && results[0] && results[0].result;
  console.log("[SFMC Inspector Reloaded SW] Probe result:", JSON.stringify(result).substring(0, 200));

  if (!result || result.error) {
    throw new Error("Could not probe SFMC session: " + (result && result.error));
  }

  // Extract stack key from hostname: mc.s51.exacttarget.com → s51
  var stackMatch = hostname.match(/\.(s\d+)\./i);

  session.hostname       = hostname;
  session.stackKey       = stackMatch ? stackMatch[1] : null;
  session.fuelBase       = fuelBase;
  session.businessUnitId = (result.data && result.data.legacyId) || null;
  session.isValid        = result.status === 200;

  chrome.storage.session.set({ sfmcSession: session });
  console.log("[SFMC Inspector Reloaded SW] Session established:", JSON.stringify(getSessionStatus()));

  return getSessionStatus();
}

// ── API call — injected into SFMC tab to use session cookies ──────────────────

async function handleApiCall(payload) {
  if (!session.fuelBase) throw new Error("Session not established. Click Refresh.");

  var tabs = await chrome.tabs.query({});
  var sfmcTab = tabs.find(function(t) {
    return t.url && t.url.includes(session.hostname);
  });
  if (!sfmcTab) throw new Error("SFMC tab not found. Keep the SFMC tab open.");

  var results = await chrome.scripting.executeScript({
    target: { tabId: sfmcTab.id },
    func: function(fuelBase, endpoint, method, body) {
      var url = fuelBase + endpoint;
      var opts = {
        method:      method || "GET",
        credentials: "include",
        headers:     { "Content-Type": "application/json" }
      };
      if (body) opts.body = JSON.stringify(body);

      return fetch(url, opts)
        .then(function(r) {
          return r.text().then(function(t) {
            return { status: r.status, text: t };
          });
        })
        .catch(function(e) { return { error: e.message }; });
    },
    args: [session.fuelBase, payload.endpoint, payload.method || "GET", payload.body || null]
  });

  var result = results && results[0] && results[0].result;
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
      usesFrameNavigation: true,
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
