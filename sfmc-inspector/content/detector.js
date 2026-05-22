/**
 * SFMC Inspector Reloaded — Content Script (detector.js)
 *
 * Runs on mc.s51.exacttarget.com (main SFMC page).
 * Intercepts SSO calls and responds to popup requests.
 */

(function () {
  "use strict";

  var _context = null;
  var _lastContextKey = null;

  function decodeJwt(t) {
    try {
      var p = t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
      return JSON.parse(atob(p + "===".slice((p.length+3)%4)));
    } catch(e) { return null; }
  }

  function processJwt(jwt) {
    if (!jwt || jwt.length < 50) return;
    var pl = decodeJwt(jwt);
    if (!pl || !pl.request || !pl.request.rest) return;
    var rest = pl.request.rest;
    var org  = pl.request.organization || {};
    var user = pl.request.user || {};
    if (!rest.refreshToken || !rest.authEndpoint) return;

    var nextContext = {
      hostname:     window.location.hostname,
      stackKey:     org.stackKey || null,
      restBase:     (rest.apiEndpointBase||"").replace(/\/$/,""),
      authEndpoint: rest.authEndpoint,
      refreshToken: rest.refreshToken,
      orgId:        org.id || null,
      region:       org.region || null,
      userEmail:    user.email || null,
    };
    var nextContextKey = [
      nextContext.hostname || "",
      nextContext.stackKey || "",
      nextContext.orgId || "",
      nextContext.restBase || ""
    ].join("|");

    _context = nextContext;
    console.log("[SFMC Inspector Reloaded] JWT captured, stack:", _context.stackKey);

    if (nextContextKey !== _lastContextKey) {
      _lastContextKey = nextContextKey;
      chrome.runtime.sendMessage({
        type: "SFMC_CONTEXT_CAPTURED",
        context: _context
      }, function() {
        // The service worker may be asleep during early page boot.
        void chrome.runtime.lastError;
      });
    }
  }

  // Intercept fetch
  var _origFetch = window.fetch;
  window.fetch = function() {
    var url = arguments[0] && arguments[0].url ? arguments[0].url : String(arguments[0]);
    return _origFetch.apply(window, arguments).then(function(r) {
      if (url.includes("SSO.aspx") && url.includes("restToken=1")) {
        r.clone().text().then(function(t) {
          var m = t.match(/name="jwt"\s+value="([^"]+)"/);
          if (m) processJwt(m[1]);
        }).catch(function(){});
      }
      return r;
    });
  };

  // Intercept XHR
  var _origOpen = XMLHttpRequest.prototype.open;
  var _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._sfmcUrl = url;
    return _origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    if (xhr._sfmcUrl && String(xhr._sfmcUrl).includes("SSO.aspx")) {
      xhr.addEventListener("load", function() {
        var m = xhr.responseText && xhr.responseText.match(/name="jwt"\s+value="([^"]+)"/);
        if (m) processJwt(m[1]);
      });
    }
    return _origSend.apply(this, arguments);
  };

  // Scan DOM
  function scanDom() {
    document.querySelectorAll('input[name="jwt"]').forEach(function(el) {
      if (el.value && el.value.length > 50) processJwt(el.value);
    });
  }
  new MutationObserver(scanDom).observe(document.documentElement, {childList:true, subtree:true});
  scanDom();

  // Active SSO probe — called on demand from popup
  function probeSSO(callback) {
    var appId = "8D08A262-A480-4E42-AAF3-F7D967FAD622";
    var url   = "/cloud/tools/SSO.aspx?restToken=1&deepLink=%2F&appId=" + appId;
    _origFetch.call(window, url, { credentials: "include" })
      .then(function(r) { return r.text(); })
      .then(function(t) {
        var m = t.match(/name="jwt"\s+value="([^"]+)"/);
        if (m) { processJwt(m[1]); }
        callback(_context);
      })
      .catch(function(e) {
        console.log("[SFMC Inspector Reloaded] SSO probe error:", e.message);
        callback(_context);
      });
  }

  function fetchFuelApi(message, callback) {
    var url = String(message.fuelBase || "") + String(message.endpoint || "");
    var opts = {
      method:      message.method || "GET",
      credentials: "include",
      headers:     {}
    };
    if (message.body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(message.body);
    }

    _origFetch.call(window, url, opts)
      .then(function(r) {
        return r.text().then(function(t) {
          callback({ ok: true, result: { status: r.status, text: t } });
        });
      })
      .catch(function(e) {
        callback({ ok: false, error: e.message });
      });
  }

  // Listen for popup
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === "REQUEST_SFMC_CONTEXT") {
      if (_context) {
        sendResponse({ ok: true, context: _context });
      } else {
        // Try active probe
        probeSSO(function(ctx) {
          sendResponse({ ok: !!ctx, context: ctx });
        });
      }
      return true; // async
    }

    if (msg.type === "SFMC_IN_PAGE_FETCH") {
      fetchFuelApi(msg, sendResponse);
      return true;
    }
  });

})();
