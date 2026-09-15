/* Miaucraft translation editor - editor logic.
   Loads i18n/pl.json (fetched when hosted, otherwise the embedded snapshot),
   keeps work in localStorage, and exports the file back as pl.json.

   Requires js/pages/i18n-editor-defaults.js to be loaded first. */
(function () {
  "use strict";

  var LS_KEY = "miaucraft-i18n-editor";
  var DEFAULT_DATA = window.I18N_EDITOR_DEFAULTS || null;

  var listEl = document.getElementById("list");
  var searchEl = document.getElementById("searchInput");
  var progressFill = document.getElementById("progressFill");
  var progressText = document.getElementById("progressText");
  var langInfoEl = document.getElementById("langInfo");
  var fileInput = document.getElementById("fileInput");
  var dropTarget = document.getElementById("dropTarget");
  var dropHint = document.getElementById("dropHint");
  var toastEl = document.getElementById("toast");
  var importModal = document.getElementById("importModal");
  var pasteInput = document.getElementById("pasteInput");

  var data = null;
  var filter = "all";
  var selectedSection = null;
  var toastTimer = null;
  var saveTimer = null;
  var editing = {}; // key -> { row, statusEl, ta, entry }

  /* ---------- persistence ---------- */

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.messages && typeof parsed.messages === "object") return parsed;
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function saveToStorage() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (e) {
      /* storage may be unavailable - ignore */
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToStorage, 400);
  }

  function fetchLiveFile() {
    return fetch("i18n/pl.json", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) return Promise.reject(new Error("HTTP " + res.status));
        return res.json();
      })
      .then(function (json) {
        if (json && json.messages && typeof json.messages === "object") return json;
        return Promise.reject(new Error("not the expected pl.json shape"));
      });
  }

  function clone(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : null;
  }

  /* ---------- data helpers ---------- */

  function flatEntries() {
    var out = [];
    var messages = data.messages || {};
    for (var key in messages) {
      if (!Object.prototype.hasOwnProperty.call(messages, key)) continue;
      var entry = messages[key];
      var section = key.indexOf(".") > 0 ? key.slice(0, key.indexOf(".")) : "(root)";
      var en;
      var pl;
      var technical;
      if (typeof entry === "string") {
        en = "";
        pl = entry;
        technical = false;
      } else if (entry && typeof entry === "object") {
        en = typeof entry.en === "string" ? entry.en : "";
        pl = typeof entry.pl === "string" ? entry.pl : "";
        technical = !!entry.doNotTranslate;
      } else {
        en = "";
        pl = "";
        technical = false;
      }
      out.push({ section: section, key: key, en: en, pl: pl, technical: technical });
    }
    out.sort(function (a, b) {
      return a.section.localeCompare(b.section) || a.key.localeCompare(b.key);
    });
    return out;
  }

  function enPlaceholders(en) {
    var m = String(en).match(/\{\w+\}/g) || [];
    var uniq = [];
    for (var i = 0; i < m.length; i++) {
      if (uniq.indexOf(m[i]) === -1) uniq.push(m[i]);
    }
    return uniq;
  }

  function hasMissingPlaceholders(entry) {
    var required = enPlaceholders(entry.en);
    if (!required.length) return false;
    var pl = String(entry.pl);
    for (var i = 0; i < required.length; i++) {
      if (pl.indexOf(required[i]) === -1) return true;
    }
    return false;
  }

  /* ---------- rendering ---------- */

  function stats(entries) {
    var total = 0;
    var done = 0;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].technical) continue;
      total++;
      if (entries[i].pl.trim() !== "") done++;
    }
    return { total: total, done: done };
  }

  function updateProgress(entries) {
    var s = stats(entries);
    var pct = s.total ? Math.round((s.done / s.total) * 100) : 100;
    progressFill.style.width = pct + "%";
    progressText.textContent = s.done + " / " + s.total + " · " + pct + "%";
  }

  function applyRowState(ed) {
    var hasPl = ed.entry.pl.trim() !== "";
    var issue = hasPl && hasMissingPlaceholders(ed.entry);
    ed.row.classList.toggle("row-done", hasPl);
    ed.row.classList.toggle("row-issue", issue);
    ed.statusEl.textContent = issue ? "⚠" : hasPl ? "✓" : "○";
    ed.statusEl.title = issue
      ? "A {placeholder} from the English string is missing or has been altered in this translation"
      : hasPl
        ? "Translated"
        : "Not translated yet";
  }

  function buildRow(entry) {
    var row = document.createElement("div");
    row.className = "row" + (entry.technical ? " row-technical" : "");

    var main = document.createElement("div");
    main.className = "row-main";

    var keyLine = document.createElement("div");
    keyLine.className = "row-key";
    keyLine.textContent = entry.key;
    if (entry.technical) {
      var tag = document.createElement("span");
      tag.className = "tag tag-technical";
      tag.textContent = "technical";
      keyLine.appendChild(tag);
    }
    var enLine = document.createElement("div");
    enLine.className = "row-en";
    enLine.textContent = entry.en || "—";

    main.appendChild(keyLine);
    main.appendChild(enLine);

    var ta = document.createElement("textarea");
    ta.className = "row-pl";
    ta.rows = 1;
    ta.value = entry.pl;
    ta.spellcheck = false;
    ta.placeholder = entry.technical ? "keep as-is" : "Translate…";
    ta.setAttribute("aria-label", entry.key);
    ta.setAttribute("lang", "pl");
    autoGrow(ta);

    var statusEl = document.createElement("div");
    statusEl.className = "row-status";
    statusEl.setAttribute("aria-hidden", "true");

    row.appendChild(main);
    row.appendChild(ta);
    row.appendChild(statusEl);

    var ed = { row: row, statusEl: statusEl, ta: ta, entry: entry };
    applyRowState(ed);

    ta.addEventListener("input", function () {
      entry.pl = ta.value;
      data.messages[entry.key] = normalizeEntry(entry);
      applyRowState(ed);
      autoGrow(ta);
      scheduleSave();
      updateProgressCached();
    });

    editing[entry.key] = ed;
    return row;
  }

  function normalizeEntry(entry) {
    var obj = { en: entry.en, pl: entry.pl };
    if (entry.technical) obj.doNotTranslate = true;
    return obj;
  }

  function autoGrow(ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  var cachedEntries = null;

  function getEntries() {
    if (!cachedEntries) cachedEntries = flatEntries();
    return cachedEntries;
  }

  function updateProgressCached() {
    updateProgress(getEntries());
  }

  function renderList() {
    var q = searchEl.value.trim().toLowerCase();
    var all = getEntries();

    updateProgress(all);

    var sectionTotals = {};
    var sectionDone = {};
    var sections = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!sectionTotals[e.section]) {
        sectionTotals[e.section] = 0;
        sectionDone[e.section] = 0;
        sections.push(e.section);
      }
      if (!e.technical) sectionTotals[e.section]++;
      if (!e.technical && e.pl.trim() !== "") sectionDone[e.section]++;
    }

    listEl.innerHTML = "";

    var shown = 0;
    for (var s = 0; s < sections.length; s++) {
      var section = sections[s];
      if (selectedSection && selectedSection !== section) continue;
      var rows = [];
      for (var j = 0; j < all.length; j++) {
        var en2 = all[j];
        if (en2.section !== section) continue;
        if (filter === "untranslated" && (en2.technical || en2.pl.trim() !== "")) continue;
        if (filter === "translated" && (en2.technical || en2.pl.trim() === "")) continue;
        if (filter === "issues" && !(en2.pl.trim() !== "" && hasMissingPlaceholders(en2))) continue;
        if (
          q &&
          (en2.key + " " + en2.en + " " + en2.pl).toLowerCase().indexOf(q) === -1
        ) {
          continue;
        }
        rows.push(en2);
      }
      if (!rows.length) continue;

      var head = document.createElement("div");
      head.className = "sec-head";
      var name = document.createElement("span");
      name.textContent = section;
      var count = document.createElement("span");
      count.className = "sec-count";
      count.textContent = sectionDone[section] +
        "/" +
        (sectionTotals[section] || 0) +
        (sectionTotals[section] && sectionDone[section] === sectionTotals[section] ? " ✓" : "");
      head.appendChild(name);
      head.appendChild(count);
      listEl.appendChild(head);

      for (var k = 0; k < rows.length; k++) {
        listEl.appendChild(buildRow(rows[k]));
        shown++;
      }
    }

    if (!shown) {
      var empty = document.createElement("div");
      empty.className = "edit-empty";
      empty.textContent = "Nothing to show.";
      listEl.appendChild(empty);
    }
  }

  /* ---------- export / import ---------- */

  function exportJson() {
    var out = { messages: data.messages };
    if (data._meta_) out._meta_ = data._meta_;
    if (data._notes_) out._notes_ = data._notes_;
    return JSON.stringify(out, null, 2);
  }

  function downloadFile() {
    var blob = new Blob([exportJson()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "pl.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
    notify("Downloaded pl.json");
  }

  function copyJson() {
    var text = exportJson();
    var count = Object.keys(data.messages || {}).length;
    var done = function () {
      notify("Copied " + count + " strings to the clipboard");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        legacyCopy(text);
      });
    } else {
      legacyCopy(text);
    }
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      notify("Copied to the clipboard");
    } catch (e) {
      notify("Copy failed - please export the file instead");
    }
    ta.remove();
  }

  function normalizeImported(json) {
    if (!json || typeof json !== "object") throw new Error("not a JSON object");
    var messages = json.messages;
    if (!messages || typeof messages !== "object") {
      // allow a plain { key: "text" } map
      messages = json;
    }
    var flatFound = false;
    var subFound = false;
    for (var key in messages) {
      if (!Object.prototype.hasOwnProperty.call(messages, key) || key === "_meta_" || key === "_notes_") continue;
      var entry = messages[key];
      if (typeof entry === "string") {
        flatFound = true;
        messages[key] = { en: "", pl: entry };
      } else if (entry && typeof entry === "object") {
        subFound = true;
        if (typeof entry.pl === "string" && typeof entry.en === "undefined") entry.en = "";
      } else {
        throw new Error("entry '" + key + "' is neither a string nor an object");
      }
    }
    if (flatFound && subFound) {
      throw new Error("mixed string and object entries - can't decide a format");
    }
    return { meta: json._meta_ || null, notes: json._notes_ || null, messages: messages, flatFormat: flatFound && !subFound };
  }

  function applyData(newData, sourceLabel) {
    data = newData;
    cachedEntries = null;
    editing = {};
    var count = Object.keys(data.messages || {}).length;
    langInfoEl.textContent =
      "Polish (pl) · source: English (en) · file: i18n/pl.json · loaded via: " + sourceLabel + " · " + count + " keys";
    renderList();
    saveToStorage();
  }

  function importJsonText(text) {
    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error("invalid JSON: " + e.message);
    }
    var n = normalizeImported(json);
    var messages = {};
    var keys = Object.keys(n.messages).sort();
    for (var i = 0; i < keys.length; i++) {
      messages[keys[i]] = n.messages[keys[i]];
    }
    applyData(
      {
        _meta_: n.meta ,
        _notes_: n.notes ,
        messages: messages,
      },
      "import"
    );
  }

  function handleFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        importJsonText(String(reader.result));
        notify("Imported " + file.name);
        closeModal();
      } catch (e) {
        notify("Import failed: " + e.message);
      }
    };
    reader.onerror = function () {
      notify("Could not read that file");
    };
    reader.readAsText(file, "utf-8");
  }

  /* ---------- toast & modal ---------- */

  function notify(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(function () {
      toastEl.classList.add("visible");
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("visible");
      setTimeout(function () {
        toastEl.hidden = true;
      }, 200);
    }, 2600);
  }

  function openModal() {
    pasteInput.value = "";
    importModal.hidden = false;
    setTimeout(function () {
      pasteInput.focus();
    }, 50);
  }

  function closeModal() {
    importModal.hidden = true;
  }

  /* ---------- events ---------- */

  window.addEventListener("dragover", function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") !== -1) {
      e.preventDefault();
      dropTarget.classList.add("dragging");
      dropHint.hidden = false;
    }
  });

  window.addEventListener("dragleave", function (e) {
    if (e.target === document.documentElement || e.target === dropTarget || e.target === dropHint) {
      dropTarget.classList.remove("dragging");
      dropHint.hidden = true;
    }
  });

  window.addEventListener("drop", function (e) {
    e.preventDefault();
    dropTarget.classList.remove("dragging");
    dropHint.hidden = true;
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && /json/i.test(file.name || "")) {
      handleFile(file);
    } else if (file) {
      notify("Please drop a .json file");
    }
  });

  document.getElementById("importBtn").addEventListener("click", openModal);
  document.getElementById("importCancelBtn").addEventListener("click", closeModal);
  document.getElementById("importChooseBtn").addEventListener("click", function () {
    fileInput.click();
  });
  document.getElementById("importApplyBtn").addEventListener("click", function () {
    if (!pasteInput.value.trim()) {
      notify("Paste some JSON first, or choose a file");
      return;
    }
    try {
      importJsonText(pasteInput.value);
      notify("Imported pasted JSON");
      closeModal();
    } catch (e) {
      notify("Import failed: " + e.message);
    }
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    fileInput.value = "";
  });
  importModal.addEventListener("click", function (e) {
    if (e.target === importModal) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  document.getElementById("downloadBtn").addEventListener("click", downloadFile);
  document.getElementById("copyBtn").addEventListener("click", copyJson);
  document.getElementById("resetBtn").addEventListener("click", function () {
    if (!confirm("Reset discards your local edits and reloads the original file. Continue?")) return;
    localStorage.removeItem(LS_KEY);
    fetchLiveFile()
      .then(function (json) {
        applyData(json, "file");
        notify("Reset - reloaded i18n/pl.json");
      })
      .catch(function () {
        if (DEFAULT_DATA) {
          applyData(clone(DEFAULT_DATA), "embedded default");
          notify("Reset - loaded embedded default (no network)");
        } else {
          notify("No data source to reset to");
        }
      });
  });

  searchEl.addEventListener("input", renderList);

  document.getElementById("filterChips").addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    filter = chip.getAttribute("data-filter");
    var chips = this.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("data-active", String(chips[i] === chip));
    }
    renderList();
  });

  /* ---------- init ---------- */

  var saved = loadFromStorage();
  if (saved) {
    applyData(saved, "saved copy");
  } else {
    fetchLiveFile()
      .then(function (json) {
        applyData(json, "file");
      })
      .catch(function () {
        if (DEFAULT_DATA) {
          applyData(clone(DEFAULT_DATA), "embedded default");
        } else {
          data = { _meta_: {}, _notes_: {}, messages: {} };
          cachedEntries = null;
          renderList();
          notify("No data found - please import a pl.json file");
        }
      });
  }
})();