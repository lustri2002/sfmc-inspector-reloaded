/**
 * SFMC Inspector Reloaded - compact popup launcher.
 */

(function () {
  "use strict";

  var state = {
    session: null,
    cache: null,
    loading: false,
    suggestions: [],
    activeSuggestion: 0
  };

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    sessionBadge: $("session-badge"),
    badgeLabel: document.querySelector(".badge-label"),
    sessionBar: $("session-bar"),
    sessionEnv: $("session-env-label"),
    sessionStack: $("session-stack-label"),
    sessionBu: $("session-bu-label"),
    sessionBuMeta: document.querySelector(".session-bu-meta"),
    sessionBuDivider: document.querySelector(".session-bu-divider"),
    noSession: $("no-session-view"),
    mainView: $("main-view"),
    btnRefresh: $("btn-refresh"),
    statusCard: $("metadata-status-card"),
    cacheLabel: $("cache-label"),
    globalSpinner: $("global-spinner"),
    search: $("metadata-search"),
    suggestions: $("suggestions"),
    btnOpenMetadata: $("btn-open-metadata"),
    btnOpenSqlSearch: $("btn-open-sql-search"),
    btnOpenQueryEditor: $("btn-open-query-editor"),
    progress: {
      de: {
        row: document.querySelector('.progress-row[data-section="de"]'),
        icon: $("de-icon"),
        value: $("de-progress")
      },
      automations: {
        row: document.querySelector('.progress-row[data-section="automations"]'),
        icon: $("automations-icon"),
        value: $("automations-progress")
      },
      journeys: {
        row: document.querySelector('.progress-row[data-section="journeys"]'),
        icon: $("journeys-icon"),
        value: $("journeys-progress")
      }
    }
  };

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
      return new Date(date).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return "-";
    }
  }

  function highlight(text, query) {
    if (!query || !text) return escHtml(text);
    var re = new RegExp("(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    return escHtml(text).replace(re, '<span class="hl">$1</span>');
  }

  function getTypeLabel(type) {
    if (type === "dataExtension") return "DE";
    if (type === "automation") return "AUTO";
    if (type === "journey") return "JNY";
    return "MD";
  }

  function getTypeName(type) {
    if (type === "dataExtension") return "Data Extension";
    if (type === "automation") return "Automation";
    if (type === "journey") return "Journey";
    return "Metadata";
  }

  function getSectionIconPath(section) {
    if (section === "de") return "../assets/icons/MetadataIcons/DataExtension.svg";
    if (section === "automations") return "../assets/icons/MetadataIcons/Automation.svg";
    if (section === "journeys") return "../assets/icons/MetadataIcons/Journey.svg";
    return "";
  }

  function setSectionProgress(section, status, label, percent) {
    var target = els.progress[section];
    if (!target) return;

    var pct = typeof percent === "number" ? Math.max(0, Math.min(100, Math.round(percent))) : null;
    target.row.classList.remove("loading", "done", "error");
    if (status) target.row.classList.add(status);
    target.row.style.setProperty("--progress-pct", pct == null ? "0%" : pct + "%");
    target.row.title = label || "";
    if (status === "done") {
      target.icon.innerHTML = '<img src="' + getSectionIconPath(section) + '" alt="" aria-hidden="true">';
    } else {
      target.icon.textContent = status === "error" ? "!" : "-";
    }
    target.value.textContent = pct == null ? "-" : pct + "%";
  }

  function setLoading(isLoading, label) {
    state.loading = isLoading;
    els.globalSpinner.classList.toggle("hidden", !isLoading);
    if (label) els.cacheLabel.textContent = label;
  }

  function setSearchEnabled(enabled) {
    els.search.disabled = !enabled;
    els.search.placeholder = enabled
      ? "Search DEs, Automations, Journeys..."
      : "Metadata index is loading...";
  }

  function count(cache, section) {
    return cache && cache[section] && Array.isArray(cache[section].items)
      ? cache[section].items.length
      : 0;
  }

  function renderCacheSummary(cache) {
    els.statusCard.classList.toggle("is-complete", MetadataStore.isComplete(cache));

    ["de", "automations", "journeys"].forEach(function (section) {
      var data = cache && cache[section] ? cache[section] : {};
      if (data.loaded) {
        setSectionProgress(section, "done", count(cache, section) + " loaded", 100);
      } else if (data.error) {
        setSectionProgress(section, "error", data.error, 100);
      } else {
        setSectionProgress(section, "", "Not loaded", 0);
      }
    });

    if (MetadataStore.isComplete(cache)) {
      els.cacheLabel.textContent = cache && cache.updatedAt
        ? "Loaded from cache · " + fmt(cache.updatedAt)
        : "Metadata ready";
    } else {
      els.cacheLabel.textContent = "Metadata partially loaded";
    }

    setSearchEnabled(count(cache, "de") + count(cache, "automations") + count(cache, "journeys") > 0);
  }

  function updateFromProgress(evt) {
    if (evt.section === "all") {
      if (evt.status === "loading") els.statusCard.classList.remove("is-complete");
      setLoading(evt.status === "loading", evt.label);
      if (evt.status === "done" || evt.status === "partial") {
        setLoading(false, evt.label);
      }
      return;
    }

    var status = evt.status === "loading" ? "loading" : evt.status === "done" ? "done" : evt.status === "error" ? "error" : "";
    var percent = 0;
    if (evt.status === "done") {
      percent = 100;
    } else if (evt.status === "error") {
      percent = 100;
    } else if (evt.total && evt.loaded != null) {
      percent = (evt.loaded / evt.total) * 100;
    } else if (evt.loaded || evt.count) {
      percent = 66;
    } else if (evt.status === "loading") {
      percent = 12;
    }
    setSectionProgress(evt.section, status, evt.label || "Loading", percent);
  }

  function buildIndex() {
    if (!state.cache) return [];

    var rows = [];
    (state.cache.de.items || []).forEach(function (item) {
      rows.push({
        type: "dataExtension",
        id: item.id,
        key: item.customerKey || item.key,
        name: item.name,
        sub: [item.customerKey || item.key, item.path].filter(Boolean).join(" · "),
        search: [item.name, item.customerKey, item.key, item.path].join(" ").toLowerCase()
      });
    });
    (state.cache.automations.items || []).forEach(function (item) {
      rows.push({
        type: "automation",
        id: item.id,
        key: item.key,
        name: item.name,
        sub: [item.key, item.status, item.schedule].filter(Boolean).join(" · "),
        search: [item.name, item.key, item.status, item.schedule].join(" ").toLowerCase()
      });
    });
    (state.cache.journeys.items || []).forEach(function (item) {
      rows.push({
        type: "journey",
        id: item.id,
        key: item.key,
        name: item.name,
        sub: ["v" + item.version, item.status, item.activityCount + " activities"].filter(Boolean).join(" · "),
        search: [item.name, item.key, item.status, item.version].join(" ").toLowerCase()
      });
    });

    return rows;
  }

  function renderSuggestions() {
    var q = els.search.value.trim().toLowerCase();
    if (!q || !state.cache) {
      state.suggestions = [];
      els.suggestions.classList.add("hidden");
      els.suggestions.innerHTML = "";
      return;
    }

    state.suggestions = buildIndex().filter(function (item) {
      return item.search.indexOf(q) !== -1;
    }).slice(0, 5);
    state.activeSuggestion = Math.min(state.activeSuggestion, Math.max(state.suggestions.length - 1, 0));

    if (state.suggestions.length === 0) {
      els.suggestions.classList.remove("hidden");
      els.suggestions.innerHTML = '<div class="suggestion-empty">No metadata matched your search.</div>';
      return;
    }

    els.suggestions.classList.remove("hidden");
    els.suggestions.innerHTML = state.suggestions.map(function (item, index) {
      return '<button class="suggestion ' + (index === state.activeSuggestion ? "active" : "") + '" data-index="' + index + '">' +
        '<span class="suggestion-type">' + getTypeLabel(item.type) + "</span>" +
        '<span class="suggestion-copy">' +
          '<span class="suggestion-title">' + highlight(item.name, q) + "</span>" +
          '<span class="suggestion-sub">' + highlight(item.sub, q) + "</span>" +
        "</span>" +
        '<span class="suggestion-arrow">↗</span>' +
      "</button>";
    }).join("");
  }

  function openExtensionPage(path) {
    if (window.FeatureFlags && !FeatureFlags.canOpenPath(path)) return;
    chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  }

  function buildMetadataExplorerPath(item) {
    var params = [];
    if (item && item.type) params.push("type=" + encodeURIComponent(item.type));
    if (item && item.id) params.push("id=" + encodeURIComponent(item.id));
    if (item && item.key) params.push("key=" + encodeURIComponent(item.key));
    return "metadata-explorer/metadata-explorer.html" + (params.length ? "?" + params.join("&") : "");
  }

  function openMetadataExplorer(item) {
    openExtensionPage(buildMetadataExplorerPath(item));
  }

  function detectSession() {
    els.sessionBadge.className = "badge badge--detecting";
    els.badgeLabel.textContent = "Detecting";

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
      els.badgeLabel.textContent = "Connected";
      els.sessionBar.classList.remove("hidden");
      els.sessionEnv.textContent = session.hostname || session.subdomain || "SFMC";
      els.sessionStack.textContent = session.stackKey || "-";
      els.noSession.classList.add("hidden");
      els.mainView.classList.remove("hidden");
      return true;
    }

    els.sessionBadge.className = "badge badge--error";
    els.badgeLabel.textContent = "No session";
    els.sessionBar.classList.add("hidden");
    els.noSession.classList.remove("hidden");
    els.mainView.classList.add("hidden");
    setSearchEnabled(false);
    return false;
  }

  function findOrganizationName(value) {
    if (!value || typeof value !== "object") return "";

    var directKeys = [
      "name",
      "displayName",
      "businessUnitName",
      "businessUnit",
      "memberName",
      "enterpriseName",
      "accountName",
      "midName"
    ];

    for (var i = 0; i < directKeys.length; i++) {
      var direct = value[directKeys[i]];
      if (typeof direct === "string" && direct.trim()) return direct.trim();
    }

    var nestedKeys = ["businessUnit", "member", "enterprise", "account", "parent"];
    for (var j = 0; j < nestedKeys.length; j++) {
      var nested = findOrganizationName(value[nestedKeys[j]]);
      if (nested) return nested;
    }

    return "";
  }

  function setBusinessUnitLabel(label) {
    var hasLabel = !!label;
    els.sessionBu.textContent = hasLabel ? label : "-";
    els.sessionBuMeta.classList.toggle("hidden", !hasLabel);
    els.sessionBuDivider.classList.toggle("hidden", !hasLabel);
  }

  function loadBusinessUnitLabel() {
    if (!state.session || !state.session.hostname) return;

    chrome.tabs.query({}, function (tabs) {
      var sfmcTab = null;
      for (var i = 0; i < tabs.length; i++) {
        var url = tabs[i].url || "";
        if (url.indexOf(state.session.hostname) !== -1) {
          sfmcTab = tabs[i];
          break;
        }
      }

      if (!sfmcTab) return;

      chrome.tabs.sendMessage(sfmcTab.id, { type: "REQUEST_SFMC_CONTEXT" }, function (resp) {
        if (chrome.runtime.lastError) return;
        if (!resp || !resp.ok || !resp.context) return;

        console.log("[SFMC Inspector Reloaded Debug] pl.request.organization:", resp.context.organization || null);
        setBusinessUnitLabel(findOrganizationName(resp.context.organization));
      });
    });
  }

  function loadMetadataIfNeeded() {
    setSearchEnabled(false);
    els.statusCard.classList.remove("is-complete");
    setSectionProgress("de", "", "Waiting", 0);
    setSectionProgress("automations", "", "Waiting", 0);
    setSectionProgress("journeys", "", "Waiting", 0);
    setLoading(true, "Checking local cache...");

    return MetadataStore.read(state.session).then(function (cache) {
      if (MetadataStore.isComplete(cache)) {
        state.cache = cache;
        setLoading(false);
        renderCacheSummary(cache);
        renderSuggestions();
        return cache;
      }

      setLoading(true, "Cache empty or expired. Loading metadata...");
      return MetadataStore.loadAll(state.session, updateFromProgress).then(function (fresh) {
        state.cache = fresh;
        setLoading(false);
        renderCacheSummary(fresh);
        renderSuggestions();
        return fresh;
      });
    }).catch(function (err) {
      setLoading(false, err && err.message ? err.message : "Could not load metadata");
      setSearchEnabled(false);
    });
  }

  function init() {
    if (window.FeatureFlags) FeatureFlags.applyVisibility(document);

    detectSession().then(function (session) {
      if (!updateSessionUI(session)) return null;
      loadBusinessUnitLabel();
      return loadMetadataIfNeeded();
    });
  }

  els.search.addEventListener("input", function () {
    state.activeSuggestion = 0;
    renderSuggestions();
  });

  els.search.addEventListener("keydown", function (evt) {
    if (evt.key === "ArrowDown") {
      evt.preventDefault();
      state.activeSuggestion = Math.min(state.activeSuggestion + 1, Math.max(state.suggestions.length - 1, 0));
      renderSuggestions();
    } else if (evt.key === "ArrowUp") {
      evt.preventDefault();
      state.activeSuggestion = Math.max(state.activeSuggestion - 1, 0);
      renderSuggestions();
    } else if (evt.key === "Enter") {
      evt.preventDefault();
      if (state.suggestions[state.activeSuggestion]) openMetadataExplorer(state.suggestions[state.activeSuggestion]);
      else openMetadataExplorer();
    } else if (evt.key === "Escape") {
      els.search.value = "";
      renderSuggestions();
    }
  });

  els.suggestions.addEventListener("click", function (evt) {
    var btn = evt.target.closest && evt.target.closest(".suggestion");
    if (!btn) return;
    var item = state.suggestions[Number(btn.dataset.index)];
    if (item) openMetadataExplorer(item);
  });

  document.addEventListener("keydown", function (evt) {
    if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === "k") {
      evt.preventDefault();
      if (!els.search.disabled) els.search.focus();
    }
  });

  els.btnOpenMetadata.addEventListener("click", function () {
    openMetadataExplorer();
  });

  els.btnOpenSqlSearch.addEventListener("click", function () {
    openExtensionPage("sql-search/sql-search.html");
  });

  els.btnOpenQueryEditor.addEventListener("click", function () {
    openExtensionPage("query-editor/query-editor.html");
  });

  els.btnRefresh.addEventListener("click", function () {
    if (!state.session || !state.session.isValid || state.loading) return;
    MetadataStore.clear().then(loadMetadataIfNeeded);
  });

  init();
})();
