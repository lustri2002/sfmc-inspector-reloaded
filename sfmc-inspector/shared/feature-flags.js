/**
 * SFMC Inspector Reloaded - static feature flags.
 * Keep beta modules committed but hidden until they are ready to ship.
 */

(function (root) {
  "use strict";

  var FEATURES = {
    metadataExplorer: {
      enabled: true,
      label: "Metadata Explorer",
      path: "metadata-explorer/metadata-explorer.html"
    },
    sqlSearch: {
      enabled: true,
      label: "SQL Search",
      path: "sql-search/sql-search.html"
    },
    queryEditor: {
      enabled: false,
      label: "Query Editor",
      path: "query-editor/query-editor.html",
      beta: true
    }
  };

  function get(featureKey) {
    return FEATURES[featureKey] || null;
  }

  function isEnabled(featureKey) {
    var feature = get(featureKey);
    return !!(feature && feature.enabled);
  }

  function featureForPath(path) {
    var normalized = String(path || "").replace(/^\//, "");
    var keys = Object.keys(FEATURES);
    for (var i = 0; i < keys.length; i++) {
      var feature = FEATURES[keys[i]];
      if (feature.path && normalized.indexOf(feature.path) === 0) return keys[i];
    }
    return "";
  }

  function canOpenPath(path) {
    var featureKey = featureForPath(path);
    return !featureKey || isEnabled(featureKey);
  }

  function applyVisibility(scope) {
    var rootNode = scope || document;
    var nodes = rootNode.querySelectorAll("[data-feature]");
    Array.prototype.forEach.call(nodes, function (node) {
      var enabled = isEnabled(node.getAttribute("data-feature"));
      node.classList.toggle("feature-hidden", !enabled);
      node.setAttribute("aria-hidden", enabled ? "false" : "true");
      if ("disabled" in node) node.disabled = !enabled;
    });
  }

  function renderUnavailable(featureKey, options) {
    var feature = get(featureKey) || { label: "This feature" };
    var homePath = options && options.homePath ? options.homePath : "panel/popup.html";
    document.body.className = "feature-unavailable-page";
    document.body.innerHTML = [
      '<main class="feature-unavailable">',
        '<div class="feature-unavailable-card">',
          '<span class="badge">Feature disabled</span>',
          '<h1>' + feature.label + " is not available yet</h1>",
          '<p>This beta module is included in the codebase, but it is hidden from the current release.</p>',
          '<button id="btn-feature-home" class="primary-btn" type="button">Back to SFMC Inspector Reloaded</button>',
        "</div>",
      "</main>"
    ].join("");

    var btn = document.getElementById("btn-feature-home");
    if (btn) {
      btn.addEventListener("click", function () {
        if (root.chrome && chrome.tabs && chrome.tabs.create && chrome.runtime) {
          chrome.tabs.create({ url: chrome.runtime.getURL(homePath) });
        } else if (root.history && history.length > 1) {
          history.back();
        }
      });
    }
  }

  function require(featureKey, options) {
    if (isEnabled(featureKey)) return true;
    renderUnavailable(featureKey, options);
    return false;
  }

  root.FeatureFlags = {
    all: FEATURES,
    get: get,
    isEnabled: isEnabled,
    featureForPath: featureForPath,
    canOpenPath: canOpenPath,
    applyVisibility: applyVisibility,
    require: require
  };
})(window);
