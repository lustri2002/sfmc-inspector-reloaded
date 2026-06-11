/**
 * SFMC Inspector - Query Editor MVP.
 * Builds a safe execution plan around SFMC Query Activities.
 */

(function () {
  "use strict";

  var state = {
    session: null
  };

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    sessionBadge: $("session-badge"),
    sessionLabel: $("session-label"),
    sessionHost: $("session-host"),
    readiness: $("editor-readiness"),
    sql: $("editor-sql"),
    lintPanel: $("lint-panel"),
    targetMode: $("target-mode"),
    targetName: $("target-name"),
    targetKey: $("target-key"),
    updateType: $("update-type"),
    planState: $("plan-state"),
    runPlan: $("run-plan"),
    consoleBox: $("console"),
    btnInsertSample: $("btn-insert-sample"),
    btnAddTop: $("btn-add-top"),
    btnClear: $("btn-clear"),
    btnBuildPlan: $("btn-build-plan"),
    btnExecute: $("btn-execute")
  };

  function hasChromeTabs() {
    return typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query;
  }

  function hasChromeRuntime() {
    return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;
  }

  function escHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function setReadiness(kind, label) {
    var cls = kind === "ready" ? "badge badge--connected"
      : kind === "blocked" ? "badge badge--error"
      : "badge badge--detecting";
    els.readiness.className = cls;
    els.readiness.textContent = label;
  }

  function normalizeTargetKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .substring(0, 64);
  }

  function splitSelectList(selectList) {
    var columns = [];
    var current = "";
    var depth = 0;
    var quote = "";

    String(selectList || "").split("").forEach(function (ch) {
      if (quote) {
        current += ch;
        if (ch === quote) quote = "";
        return;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        current += ch;
        return;
      }
      if (ch === "(") depth++;
      if (ch === ")" && depth > 0) depth--;
      if (ch === "," && depth === 0) {
        columns.push(current.trim());
        current = "";
        return;
      }
      current += ch;
    });

    if (current.trim()) columns.push(current.trim());
    return columns;
  }

  function inferOutputColumns(sql) {
    var compact = String(sql || "")
      .replace(/--[^\n]*/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    var match = compact.match(/\bselect\b([\s\S]+?)\bfrom\b/i);
    if (!match) return [];

    var selectList = match[1]
      .replace(/^\s*distinct\b/i, "")
      .replace(/^\s*top\s*\(?\s*\d+\s*\)?/i, "")
      .trim();

    return splitSelectList(selectList).map(function (expr) {
      var asMatch = expr.match(/\bas\s+(\[[^\]]+\]|"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*$/i);
      if (asMatch) return asMatch[1].replace(/^\[|\]$/g, "").replace(/^"|"$/g, "");

      var tail = expr.match(/(?:^|\.)(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*$/);
      return tail ? tail[1].replace(/^\[|\]$/g, "") : expr.substring(0, 36);
    }).filter(Boolean).slice(0, 16);
  }

  function getSafetyWarnings(sql) {
    var warnings = [];
    var trimmed = String(sql || "").trim();
    if (!trimmed) {
      warnings.push({ severity: "error", title: "SQL required", message: "Paste a SELECT query before building a run plan." });
      return warnings;
    }

    if (!/^\s*(with\b[\s\S]+?\)\s*)*select\b/i.test(trimmed)) {
      warnings.push({ severity: "error", title: "Only SELECT is supported", message: "SFMC Query Activities should be modelled as SELECT statements that write to a configured target Data Extension." });
    }

    if (/\b(insert|update|delete|drop|alter|create|merge|truncate|exec|execute)\b/i.test(trimmed)) {
      warnings.push({ severity: "error", title: "Unsafe SQL verb", message: "This MVP blocks SQL verbs that could mutate objects outside the Query Activity target." });
    }

    if (!/\btop\s*\(?\s*\d+\s*\)?/i.test(trimmed)) {
      warnings.push({ severity: "warning", title: "No preview limit", message: "Add TOP 100 while testing so the scratch Data Extension stays small." });
    }

    if (!/\bfrom\b/i.test(trimmed)) {
      warnings.push({ severity: "warning", title: "No FROM detected", message: "The output-column inference and target schema preview need a FROM clause." });
    }

    return warnings;
  }

  function addTopPreview(sql) {
    var text = String(sql || "").trim();
    if (!text || /\btop\s*\(?\s*\d+\s*\)?/i.test(text)) return text;
    return text.replace(/^\s*select\s+/i, "SELECT TOP 100 ");
  }

  function renderDiagnostics(lintResult, safetyWarnings) {
    var diagnostics = (safetyWarnings || []).concat((lintResult && lintResult.diagnostics) || []);
    if (!diagnostics.length) {
      return '<div class="diagnostic-list"><div class="diagnostic"><div class="diagnostic-title">' +
        '<span class="tag tag--green">OK</span>No SQL diagnostics</div><p>The query is clean enough for a preview run plan.</p></div></div>';
    }

    return '<div class="diagnostic-list">' + diagnostics.map(function (d) {
      var cls = d.severity === "error" ? "red" : d.severity === "warning" ? "yellow" : "blue";
      return '<div class="diagnostic">' +
        '<div class="diagnostic-title"><span class="tag tag--' + cls + '">' + escHtml(d.severity || "info") + "</span>" +
          escHtml(d.id ? d.id + " - " + d.title : d.title || "Diagnostic") + "</div>" +
        (d.message ? "<p>" + escHtml(d.message) + "</p>" : "") +
        (d.fix ? '<div class="diagnostic-fix">Fix: ' + escHtml(d.fix) + "</div>" : "") +
      "</div>";
    }).join("") + "</div>";
  }

  function renderAnalysis(buildPlan) {
    var sql = els.sql.value;
    var lintResult = typeof SqlLinter !== "undefined" ? SqlLinter.lint(sql) : { diagnostics: [], score: 100 };
    var safetyWarnings = getSafetyWarnings(sql);
    var hasErrors = safetyWarnings.some(function (d) { return d.severity === "error"; }) ||
      (lintResult.diagnostics || []).some(function (d) { return d.severity === "error"; });
    var columns = inferOutputColumns(sql);
    var targetName = els.targetName.value.trim();
    var targetKey = els.targetKey.value.trim();

    els.lintPanel.innerHTML =
      '<div class="lint-summary">' +
        '<div><span class="panel-title">Static analysis</span><div class="muted">' +
          (columns.length ? columns.length + " inferred output column" + (columns.length !== 1 ? "s" : "") : "No columns inferred yet") +
        '</div></div>' +
        '<div class="lint-score">' + (lintResult.score != null ? lintResult.score : "-") + "</div>" +
      "</div>" +
      renderDiagnostics(lintResult, safetyWarnings);

    if (columns.length) {
      els.consoleBox.textContent = "Inferred output columns:\n" + columns.map(function (col) {
        return "- " + col;
      }).join("\n");
    } else {
      els.consoleBox.textContent = "Paste SQL to see lint diagnostics, inferred output columns and the SFMC API workflow this MVP would run.";
    }

    if (!buildPlan) {
      setReadiness(hasErrors ? "blocked" : "draft", hasErrors ? "Blocked" : "Draft");
      return;
    }

    var planErrors = [];
    if (!state.session || !state.session.isValid) planErrors.push("Detect an active SFMC session.");
    if (!targetName) planErrors.push("Choose a target Data Extension name.");
    if (!targetKey) planErrors.push("Choose a target Customer Key.");
    if (hasErrors) planErrors.push("Resolve blocking SQL diagnostics.");

    var modeLabel = els.targetMode.value === "scratch" ? "Create or reuse scratch Data Extension" : "Use existing Data Extension";
    var steps = [
      modeLabel + " `" + (targetKey || "customer_key") + "`.",
      "Create/update a temporary Query Activity with the SQL text and " + els.updateType.value + " write mode.",
      "Perform the Query Activity and poll AsyncActivityStatus.",
      "Read rows from the target Data Extension for preview.",
      els.targetMode.value === "scratch" ? "Offer cleanup for scratch Query Activity and Data Extension." : "Leave the existing target untouched after preview."
    ];
    var visiblePlan = planErrors.length
      ? planErrors.map(function (err) { return "Prerequisite: " + err; }).concat(steps)
      : steps;

    els.runPlan.innerHTML = visiblePlan.map(function (step) {
      return "<li>" + escHtml(step) + "</li>";
    }).join("");
    els.planState.textContent = planErrors.length ? "Blocked" : "Ready";
    setReadiness(planErrors.length ? "blocked" : "ready", planErrors.length ? "Blocked" : "Ready");
    els.btnExecute.disabled = true;
    els.consoleBox.textContent = (planErrors.length
      ? "Run plan blocked before execute:\n" + planErrors.map(function (err) { return "- " + err; }).join("\n") +
        "\n\nPlanned workflow:\n" + steps.map(function (step, index) { return (index + 1) + ". " + step; }).join("\n")
      : "Run plan ready. Execute is intentionally disabled in this MVP until the API write path is confirmed.\n\n" + steps.map(function (step, index) {
          return (index + 1) + ". " + step;
        }).join("\n"));
  }

  function loadSession() {
    updateSessionUI(null);
    SfmcApi.getSession().then(function (session) {
      if (session && session.isValid) {
        updateSessionUI(session);
        return;
      }

      if (!hasChromeTabs() || !hasChromeRuntime()) {
        updateSessionUI(null);
        els.consoleBox.textContent = "Extension runtime is not available in this preview. Load the extension to detect an SFMC session.";
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
          els.consoleBox.textContent = "Open Salesforce Marketing Cloud in another tab, then build a plan again.";
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
            els.consoleBox.textContent = chrome.runtime.lastError
              ? chrome.runtime.lastError.message
              : "Could not detect SFMC session.";
            return;
          }

          updateSessionUI(resp.session);
        });
      });
    });
  }

  els.sql.addEventListener("input", function () {
    renderAnalysis(false);
  });
  els.targetMode.addEventListener("change", function () {
    renderAnalysis(false);
  });
  els.targetName.addEventListener("input", function () {
    if (!els.targetKey.value.trim()) {
      els.targetKey.value = normalizeTargetKey(els.targetName.value);
    }
    renderAnalysis(false);
  });
  els.targetKey.addEventListener("input", function () {
    renderAnalysis(false);
  });
  els.updateType.addEventListener("change", function () {
    renderAnalysis(false);
  });
  els.btnInsertSample.addEventListener("click", function () {
    els.sql.value = [
      "SELECT TOP 100",
      "  SubscriberKey,",
      "  EventDate,",
      "  JobID",
      "FROM _Sent WITH (NOLOCK)",
      "ORDER BY EventDate DESC"
    ].join("\n");
    if (!els.targetName.value.trim()) els.targetName.value = "SFMC Inspector Preview";
    if (!els.targetKey.value.trim()) els.targetKey.value = "sfmc_inspector_preview";
    renderAnalysis(true);
  });
  els.btnAddTop.addEventListener("click", function () {
    els.sql.value = addTopPreview(els.sql.value);
    renderAnalysis(true);
  });
  els.btnClear.addEventListener("click", function () {
    els.sql.value = "";
    els.runPlan.innerHTML = "";
    els.planState.textContent = "Not built";
    renderAnalysis(false);
  });
  els.btnBuildPlan.addEventListener("click", function () {
    renderAnalysis(true);
  });
  els.btnExecute.addEventListener("click", function () {
    els.consoleBox.textContent = "Execute is disabled for this MVP. Next step: wire QueryDefinition create/update, Perform, status polling and Data Extension row preview.";
  });

  renderAnalysis(false);
  loadSession();
})();
