/*
 * Country rules screen for a container extension request platform.
 * Interface code only; all calculations and validation live in logic.js.
 */
(function () {
  'use strict';

  const L = window.ExtensionLogic;
  const KEYS = { countries: 'cep.v1.countries', history: 'cep.v1.history' };
  const CODES = ['A', 'B', 'C', 'D'];
  const NUM_FIELDS = ['freeDays', 'longestExtension', 'extensionsAllowed', 'approvalThreshold'];
  const ROLES = {
    admin: { name: 'Operations admin', initials: 'OA' },
    viewer: { name: 'Viewer', initials: 'VW' }
  };
  const OTHER_ADMIN = 'Another operations admin';
  const NOT_ALLOWED = 'Only operations admins can change rules.';
  const SAVE_FAILED = "Couldn't save. Please try again.";
  const MAX_CELLS = 45;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const countryName = (code) => 'Country ' + code;

  // ---------- Starting values ----------

  function startingCountries() {
    const make = (settings, paymentOrder) => ({ settings, paymentOrder, version: 1, lastChange: null });
    return {
      A: make({ freeDays: 5, arrivalCountsAsDay1: true, excludedWeekdays: [], longestExtension: 14, extensionsAllowed: 2, approvalThreshold: null }, 'Approve first, then pay'),
      B: make({ freeDays: 7, arrivalCountsAsDay1: true, excludedWeekdays: [], longestExtension: 10, extensionsAllowed: 1, approvalThreshold: null }, 'Approve first, then pay'),
      C: make({ freeDays: 3, arrivalCountsAsDay1: true, excludedWeekdays: [], longestExtension: 21, extensionsAllowed: 2, approvalThreshold: null }, 'Approve first, then pay'),
      D: make({ freeDays: 3, arrivalCountsAsDay1: false, excludedWeekdays: ['Sat', 'Sun'], longestExtension: null, extensionsAllowed: null, approvalThreshold: 7 }, 'Pay first, then approval')
    };
  }

  // ---------- Storage (localStorage with an in-memory fallback) ----------

  const memory = {};
  let storageOk = true;

  function readKey(key) {
    if (storageOk) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
      } catch (e) { storageOk = false; }
    }
    return key in memory ? JSON.parse(memory[key]) : null;
  }
  function writeKey(key, value) {
    const raw = JSON.stringify(value);
    memory[key] = raw;
    if (storageOk) {
      try { window.localStorage.setItem(key, raw); } catch (e) { storageOk = false; }
    }
  }
  function clearStored() {
    Object.values(KEYS).forEach((k) => {
      delete memory[k];
      try { window.localStorage.removeItem(k); } catch (e) { /* storage unavailable */ }
    });
  }
  function loadCountries() {
    let stored = readKey(KEYS.countries);
    if (!stored || CODES.some((c) => !stored[c])) {
      stored = startingCountries();
      writeKey(KEYS.countries, stored);
    }
    return stored;
  }
  function loadHistory() { return readKey(KEYS.history) || []; }

  // ?reset=1 clears stored data and reloads without the parameter.
  const params = new URLSearchParams(window.location.search);
  if (params.has('reset')) {
    clearStored();
    params.delete('reset');
    const q = params.toString();
    window.location.replace(window.location.pathname + (q ? '?' + q : '') + window.location.hash);
    return;
  }

  // ---------- In-page state ----------

  let countries = loadCountries();
  let history = loadHistory();
  let role = 'admin';
  let selected = 'A';
  let form = null;   // { code, baseline, values, loadedVersion, touched, submitted }
  let reason = '';
  let pendingAction = null;
  let leaving = false;

  const cloneSettings = (s) => Object.assign({}, s, { excludedWeekdays: (s.excludedWeekdays || []).slice() });
  const isValid = (s) => L.validateSettings(s).length === 0;

  function toValues(s) {
    const v = cloneSettings(s);
    NUM_FIELDS.forEach((k) => { v[k] = s[k] === null || s[k] === undefined ? '' : String(s[k]); });
    return v;
  }
  function toSettings(v) {
    const s = cloneSettings(v);
    NUM_FIELDS.forEach((k) => {
      const r = L.readWhole(v[k]);
      s[k] = r.blank ? null : r.invalid ? String(v[k]).trim() : r.value;
    });
    return s;
  }
  function loadForm(code, keepReason) {
    const c = countries[code];
    form = { code, baseline: cloneSettings(c.settings), values: toValues(c.settings),
      loadedVersion: c.version, touched: new Set(), submitted: false };
    if (!keepReason) reason = '';
  }
  const proposed = () => toSettings(form.values);
  const pendingChanges = () => L.listChanges(form.baseline, proposed());
  const isDirty = () => role === 'admin' && pendingChanges().length > 0;

  // ---------- Formatting ----------

  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtTime = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtWhen = (iso) => { const d = new Date(iso); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' + fmtTime(iso); };
  function localISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nextFriday() {
    const d = new Date();
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    return localISO(d);
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // ---------- Banners ----------

  function banner(el, type, text, button) {
    el.innerHTML = '';
    if (!text) return;
    const marks = { success: '✓', error: '✕', info: 'i', warn: '!' };
    const cls = { success: 'banner banner-success', error: 'banner banner-error', info: 'notice notice-info', warn: 'notice notice-warn' };
    const box = document.createElement('div');
    box.className = cls[type];
    box.innerHTML = '<span class="notice-mark" aria-hidden="true">' + marks[type] + '</span><div class="banner-body"><span></span></div>';
    box.querySelector('.banner-body span').textContent = text;
    if (button) box.querySelector('.banner-body').appendChild(button);
    el.appendChild(box);
  }
  function clearBanners() {
    banner($('save-banner'), '', '');
    banner($('history-banner'), '', '');
    banner($('top-notice'), '', '');
    $('error-summary').hidden = true;
  }

  // ---------- The single write path ----------
  // Enforces the role, validates, writes the history first and then the settings.
  // If the history entry cannot be written, the change is not saved.
  function commitChange(code, next, why, who, actingRole, opts) {
    opts = opts || {};
    if (actingRole !== 'admin') return { ok: false, message: NOT_ALLOWED };
    countries = loadCountries();
    history = loadHistory();
    const c = countries[code];
    const changes = L.listChanges(c.settings, next);
    let errors = L.validateSettings(next);
    if (opts.changedOnly) errors = errors.filter((e) => changes.some((ch) => ch.field === e.field));
    if (errors.length) return { ok: false, errors };
    if (!changes.length) return { ok: false, noChange: true };

    const time = new Date().toISOString();
    const entries = changes.map((ch) => ({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      code, field: ch.field, from: c.settings[ch.field], to: next[ch.field], who, time, reason: why
    }));
    const newHistory = entries.concat(history);
    const newCountries = Object.assign({}, countries);
    newCountries[code] = Object.assign({}, c, { settings: cloneSettings(next), version: c.version + 1, lastChange: { who, time } });

    try {
      writeKey(KEYS.history, newHistory);
    } catch (e) {
      return { ok: false, message: SAVE_FAILED };
    }
    try {
      writeKey(KEYS.countries, newCountries);
    } catch (e) {
      try { writeKey(KEYS.history, history); } catch (ignored) { /* best effort rollback */ }
      return { ok: false, message: SAVE_FAILED };
    }
    history = newHistory;
    countries = newCountries;
    return { ok: true, count: changes.length };
  }

  // ---------- Header / account ----------

  function renderAccount() {
    const r = ROLES[role];
    $('account-initials').textContent = r.initials;
    $('account-role').textContent = r.name;
    $('account-button').setAttribute('aria-label', 'Account: ' + r.name);
    $('account-signed').textContent = 'Signed in as ' + r.name;
    $('account-switch').textContent = role === 'admin' ? 'Switch to read-only viewer' : 'Switch to operations admin';
  }
  function toggleMenu(open) {
    const menu = $('account-menu');
    const show = open === undefined ? menu.hidden : open;
    menu.hidden = !show;
    $('account-button').setAttribute('aria-expanded', String(show));
    if (show) $('account-switch').focus();
  }

  // ---------- Tabs and top lines ----------

  function renderTabs() {
    $('tabs').innerHTML = CODES.map((code) => {
      const live = isValid(countries[code].settings);
      const sel = code === selected;
      return '<button type="button" role="tab" class="tab" id="tab-' + code + '" aria-selected="' + sel + '" tabindex="' + (sel ? 0 : -1) +
        '" aria-controls="step-1">' + countryName(code) +
        '<span class="chip-status ' + (live ? 'live' : 'incomplete') + '">' + (live ? 'Live' : 'Incomplete') + '</span></button>';
    }).join('');
  }
  function renderLastChanged() {
    const lc = countries[selected].lastChange;
    $('last-changed').textContent = lc ? 'Last changed ' + fmtWhen(lc.time) + ' by ' + lc.who : 'No changes yet';
  }

  // ---------- Step 1 ----------

  function renderStep1() {
    const c = countries[selected];
    const name = countryName(selected);
    const viewer = role === 'viewer';
    $('step-1-title').textContent = 'Set the rules for ' + name;
    $('viewer-notice').hidden = !viewer;
    const incomplete = !isValid(c.settings);
    $('incomplete-notice').hidden = viewer || !incomplete;
    $('incomplete-text').textContent = name + " isn't ready yet. Add the missing rules below. Until then, importers in " + name + " can't request extensions.";
    $('rules-form').hidden = viewer;
    $('readonly-view').hidden = !viewer;
    document.querySelectorAll('.payment-value').forEach((el) => { el.textContent = c.paymentOrder; });
    if (viewer) renderReadonly();
  }

  function renderReadonly() {
    const c = countries[selected];
    const s = c.settings;
    const num = (v, unit) => (v === null ? null : v + ' ' + unit);
    const item = (label, value, fallback) =>
      '<div><dt>' + esc(label) + '</dt><dd' + (value === null && !fallback ? ' class="empty"' : '') + '>' +
      esc(value !== null ? value : fallback || 'Not set yet') + '</dd></div>';
    const excluded = s.excludedWeekdays.length ? L.displayValue('excludedWeekdays', s.excludedWeekdays) : 'None, every day counts';
    const lock = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
    $('readonly-view').innerHTML =
      '<div class="ro-group"><h3>Free time at the port</h3><dl class="ro-list">' +
      item('Free days', num(s.freeDays, 'days')) +
      item('Counting starts', L.displayValue('arrivalCountsAsDay1', s.arrivalCountsAsDay1)) +
      item("Days that don't count", excluded) +
      '</dl></div>' +
      '<div class="ro-group"><h3>Extensions</h3><dl class="ro-list">' +
      item('Longest extension', num(s.longestExtension, 'days')) +
      item('Extensions allowed', num(s.extensionsAllowed, s.extensionsAllowed === 1 ? 'time' : 'times')) +
      item('Approval needed above', num(s.approvalThreshold, 'days'), 'No approval needed') +
      '<div><dt>Payment order</dt><dd>' + lock + esc(c.paymentOrder) + '</dd></div>' +
      '</dl></div>';
  }

  function fillForm() {
    NUM_FIELDS.forEach((k) => { $('in-' + k).value = form.values[k]; });
    document.querySelectorAll('input[name=arrival]').forEach((r) => {
      r.checked = (r.value === 'yes') === form.values.arrivalCountsAsDay1;
    });
    $('in-reason').value = reason;
  }

  function visibleError(field, errors) {
    const err = errors.find((e) => e.field === field);
    if (!err) return null;
    return form.touched.has(field) || form.submitted ? err : null;
  }

  function renderFieldStates() {
    const errors = L.validateSettings(proposed());
    ['freeDays', 'longestExtension', 'extensionsAllowed', 'approvalThreshold', 'excludedWeekdays', 'arrivalCountsAsDay1'].forEach((f) => {
      const wrap = document.querySelector('.field[data-field="' + f + '"]');
      const shown = visibleError(f, errors);
      wrap.classList.toggle('invalid', !!shown);
      $('err-' + f).textContent = shown ? shown.message : '';
      const input = $('in-' + f);
      if (input) input.setAttribute('aria-invalid', String(!!shown));
      const needed = wrap.querySelector('.needed');
      if (needed) {
        const blank = errors.some((e) => e.field === f && e.blank);
        needed.hidden = !(blank && !shown);
      }
    });

    const ex = form.values.excludedWeekdays;
    document.querySelectorAll('#chips .chip').forEach((b) => {
      b.setAttribute('aria-pressed', String(ex.indexOf(b.dataset.day) !== -1));
    });
    $('sentence-excluded').textContent = L.excludedSentence(ex);

    const reasonShown = form.submitted && !reason.trim();
    $('err-reason').textContent = reasonShown ? 'Add a short reason so your team knows why this changed.' : '';
    document.querySelector('.field[data-field="reason"]').classList.toggle('invalid', reasonShown);
    $('in-reason').setAttribute('aria-invalid', String(reasonShown));
  }

  // ---------- Step 2 ----------

  const DUE_FIELDS = ['freeDays', 'excludedWeekdays', 'arrivalCountsAsDay1'];

  function cannot(err) {
    return "Can't be worked out yet: " + L.LABELS[err.field] + (err.blank ? ' is missing.' : ' needs fixing.');
  }

  function resultLines(s, arrival, daysRaw) {
    const errors = L.validateSettings(s);
    const dueErr = errors.find((e) => DUE_FIELDS.indexOf(e.field) !== -1);
    const lines = [];
    let due = null;
    if (!L.parseDate(arrival)) {
      lines.push({ text: 'Pick the date the container arrives.', bad: true });
    } else if (dueErr) {
      lines.push({ text: cannot(dueErr), bad: true });
    } else {
      due = L.freeDayDueDate(arrival, s.freeDays, s.arrivalCountsAsDay1, s.excludedWeekdays);
      lines.push({ text: 'Free days end on ' + L.formatShortDate(due) });
    }

    const days = L.readWhole(daysRaw);
    const longestErr = errors.find((e) => e.field === 'longestExtension');
    if (!due) {
      lines.push({ text: lines[0].text, bad: true });
    } else if (days.value === undefined || days.value < 1) {
      lines.push({ text: 'Enter how many extra days the importer asks for.', bad: true });
    } else if (longestErr) {
      lines.push({ text: cannot(longestErr), bad: true });
    } else {
      const ext = L.extendDeadline(due, days.value, s.longestExtension);
      lines.push(ext.ok
        ? { text: 'After ' + plural(days.value, 'extra day', 'extra days') + ' the new deadline is ' + L.formatShortDate(ext.deadline) }
        : { text: ext.message, bad: true });
    }
    return lines;
  }

  function renderPreview() {
    const arrival = $('pv-arrival').value;
    const daysRaw = $('pv-days').value;
    const saved = countries[selected].settings;
    const viewer = role === 'viewer';
    const savedLines = resultLines(saved, arrival, daysRaw);
    const lineHtml = (l, changed) =>
      '<p class="result-line' + (l.bad ? ' bad' : '') + (changed ? ' changed' : '') + '">' + esc(l.text) +
      (changed ? '<span class="tag-changed">changed</span>' : '') + '</p>';

    let html = '<div class="result-col"><h3>Saved rules</h3>' + savedLines.map((l) => lineHtml(l, false)).join('') + '</div>';
    if (!viewer) {
      html += '<div class="result-col"><h3>With your changes</h3>';
      if (!isDirty()) {
        html += '<p class="result-line muted">No changes yet</p>';
      } else {
        html += resultLines(proposed(), arrival, daysRaw).map((l, i) => lineHtml(l, !l.bad && !savedLines[i].bad && l.text !== savedLines[i].text)).join('');
      }
      html += '</div>';
    }
    $('results').innerHTML = html;
    $('results').classList.toggle('single', viewer);

    renderStrip(viewer ? saved : proposed(), arrival, daysRaw);
  }

  function renderStrip(s, arrival, daysRaw) {
    const errors = L.validateSettings(s);
    const dueErr = errors.find((e) => DUE_FIELDS.indexOf(e.field) !== -1);
    const msg = $('strip-message');
    const strip = $('strip');
    if (!L.parseDate(arrival) || dueErr) {
      strip.innerHTML = '';
      strip.parentElement.hidden = true;
      $('legend').hidden = true;
      msg.textContent = 'The day-by-day view appears once the free-day rules are complete.';
      return;
    }
    strip.parentElement.hidden = false;
    $('legend').hidden = false;
    const days = L.readWhole(daysRaw).value;
    const longest = errors.some((e) => e.field === 'longestExtension') ? null : s.longestExtension;
    const result = L.buildDayStrip(arrival, Object.assign({}, s, { longestExtension: longest }), days, MAX_CELLS);
    strip.innerHTML = result.cells.map((c) => {
      const date = c.weekday + ' ' + c.day;
      let label;
      let spoken;
      if (c.state === 'free') { label = 'Free ' + c.n; spoken = 'free day ' + c.n; }
      else if (c.state === 'extra') { label = 'Extra ' + c.n; spoken = 'extra day ' + c.n; }
      else if (c.state === 'excluded') { label = 'Skip'; spoken = "doesn't count"; }
      else { label = 'Arrives'; spoken = 'not a free day'; }
      if (c.arrival) spoken = 'arrives, ' + spoken;
      return '<li class="cell ' + c.state + (c.arrival ? ' is-arrival' : '') + '" aria-label="' + esc(date + ': ' + spoken) + '">' +
        '<span class="wd" aria-hidden="true">' + c.weekday + '</span><span class="dn" aria-hidden="true">' + c.day + '</span>' +
        '<span class="lbl" aria-hidden="true">' + label + '</span></li>';
    }).join('');
    const notes = [];
    if (days && !result.deadline) notes.push("Extra days aren't shown because this request can't be worked out or isn't allowed.");
    if (result.truncated) notes.push('Showing the first ' + MAX_CELLS + ' days.');
    msg.textContent = notes.join(' ');
  }

  // ---------- Step 3 ----------

  function renderStep3() {
    const viewer = role === 'viewer';
    $('step-3').hidden = viewer;
    $('history-num').textContent = viewer ? '3' : '4';
    if (viewer) return;
    const changes = pendingChanges();
    $('no-changes').hidden = changes.length > 0;
    $('changes-block').hidden = changes.length === 0;
    $('change-list').innerHTML = changes.map((c) =>
      '<li><span>' + esc(c.label) + ': <span class="from">' + esc(c.from) + '</span> → <strong>' + esc(c.to) + '</strong></span></li>').join('');
    $('save-button').setAttribute('aria-disabled', String(changes.length === 0));
    $('discard-button').disabled = changes.length === 0;
    if (!changes.length) $('error-summary').hidden = true;
  }

  function focusTarget(field) {
    if (field === 'excludedWeekdays') return document.querySelector('#chips .chip');
    if (field === 'arrivalCountsAsDay1') return document.querySelector('input[name=arrival]');
    return $('in-' + field);
  }

  function showErrorSummary(problems) {
    const box = $('error-summary');
    box.innerHTML = '<p>Fix ' + plural(problems.length, 'thing', 'things') + ' before saving:</p><ul>' +
      problems.map((p) => '<li><a href="#" data-target="' + p.field + '">' + esc(p.label + ': ' + p.message) + '</a></li>').join('') + '</ul>';
    box.hidden = false;
  }

  function save() {
    const status = $('save-banner');
    $('error-summary').hidden = true;
    if (role !== 'admin') return banner(status, 'error', NOT_ALLOWED);
    if (!pendingChanges().length) return banner(status, 'info', 'There are no changes to save.');

    form.submitted = true;
    const problems = L.validateSettings(proposed()).map((e) => ({ field: e.field, label: L.LABELS[e.field], message: e.message }));
    if (!reason.trim()) problems.push({ field: 'reason', label: 'Reason', message: 'Add a short reason so your team knows why this changed.' });
    renderFieldStates();
    if (problems.length) {
      banner(status, '', '');
      showErrorSummary(problems);
      const first = focusTarget(problems[0].field);
      if (first) first.focus();
      return;
    }

    countries = loadCountries();
    const c = countries[form.code];
    if (c.version !== form.loadedVersion) {
      const who = c.lastChange ? c.lastChange.who : OTHER_ADMIN;
      const at = c.lastChange ? fmtTime(c.lastChange.time) : '';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'button secondary small';
      b.textContent = 'Reload latest values';
      b.addEventListener('click', reloadLatest);
      banner(status, 'error', 'Settings were changed by ' + who + ' at ' + at + '. Reload to continue.', b);
      renderTabs();
      renderLastChanged();
      return;
    }

    const res = commitChange(form.code, proposed(), reason.trim(), ROLES[role].name, role);
    if (res.noChange) return banner(status, 'info', 'There are no changes to save.');
    if (!res.ok) return banner(status, 'error', res.message || SAVE_FAILED);

    const name = countryName(form.code);
    loadForm(form.code);
    renderAll();
    banner(status, 'success', 'Saved. New requests in ' + name + ' will use these rules. Requests already made keep their deadlines.');
  }

  function reloadLatest() {
    countries = loadCountries();
    history = loadHistory();
    loadForm(selected, true);
    renderAll();
    banner($('save-banner'), 'info', 'Latest values loaded. Make your change again, then save.');
    $('in-freeDays').focus();
  }

  function discard() {
    countries = loadCountries();
    loadForm(selected);
    clearBanners();
    renderAll();
  }

  // ---------- Step 4 ----------

  function renderHistory() {
    const all = $('all-countries').checked;
    const items = history.filter((h) => all || h.code === selected);
    const admin = role === 'admin';
    if (!items.length) {
      $('history').innerHTML = '<p class="history-empty">No changes yet. When someone saves a change, it will appear here.</p>';
      return;
    }
    $('history').innerHTML = '<table class="history-table"><thead><tr><th scope="col">Change</th><th scope="col">Country</th>' +
      '<th scope="col">When</th><th scope="col">Who</th><th scope="col">Reason</th>' + (admin ? '<th scope="col"><span class="visually-hidden">Restore</span></th>' : '') +
      '</tr></thead><tbody>' + items.map((h) =>
        '<tr><td class="what">' + esc(L.describeChange(h.field, h.from, h.to)) + '</td>' +
        '<td>' + countryName(h.code) + '</td><td>' + esc(fmtWhen(h.time)) + '</td><td>' + esc(h.who) + '</td>' +
        '<td class="reason">Reason: ' + esc(h.reason) + '</td>' +
        (admin ? '<td class="act"><button type="button" class="text-button" data-restore="' + esc(h.id) + '" aria-label="Restore ' +
          esc(L.LABELS[h.field] + ' for ' + countryName(h.code) + ' to ' + L.displayValue(h.field, h.from)) + '">Restore</button></td>' : '') +
        '</tr>').join('') + '</tbody></table>';
  }

  function restore(id) {
    const status = $('history-banner');
    if (role !== 'admin') return banner(status, 'error', NOT_ALLOWED);
    countries = loadCountries();
    history = loadHistory();
    const entry = history.find((h) => h.id === id);
    if (!entry) return;
    const name = countryName(entry.code);
    const label = L.LABELS[entry.field];
    if (form.code === entry.code && isDirty()) {
      return banner(status, 'error', 'You have unsaved changes to ' + name + '. Save or discard them first, then restore.');
    }
    const c = countries[entry.code];
    if (L.sameValue(c.settings[entry.field], entry.from)) {
      return banner(status, 'info', label + ' for ' + name + ' is already ' + L.displayValue(entry.field, entry.from) + '.');
    }
    const next = cloneSettings(c.settings);
    next[entry.field] = Array.isArray(entry.from) ? entry.from.slice() : entry.from;
    const res = commitChange(entry.code, next, 'Restored earlier value', ROLES[role].name, role);
    if (!res.ok) {
      const why = res.errors ? res.errors.map((e) => L.LABELS[e.field] + ': ' + e.message).join(' ') : res.message;
      return banner(status, 'error', "Can't restore this, because " + name + "'s rules would no longer be valid. " + why);
    }
    if (form.code === entry.code) loadForm(entry.code, true);
    renderAll();
    banner(status, 'success', 'Saved. New requests in ' + name + ' will use these rules. Requests already made keep their deadlines.');
  }

  // ---------- Unsaved bar ----------

  function renderBar() {
    const n = isDirty() ? pendingChanges().length : 0;
    $('unsaved-bar').hidden = n === 0;
    document.body.classList.toggle('has-bar', n > 0);
    $('unsaved-text').textContent = plural(n, 'unsaved change', 'unsaved changes');
  }

  // ---------- Render orchestration ----------

  function update() {
    renderFieldStates();
    renderPreview();
    renderStep3();
    renderBar();
  }
  function renderAll() {
    renderAccount();
    renderTabs();
    renderLastChanged();
    renderStep1();
    fillForm();
    renderHistory();
    update();
  }

  // ---------- Guarded actions (discard dialog) ----------

  function guard(action) {
    if (!isDirty()) return action();
    const dialog = $('discard-dialog');
    if (typeof dialog.showModal !== 'function') {
      if (window.confirm('Discard unsaved changes to ' + countryName(form.code) + '?')) action();
      return;
    }
    pendingAction = action;
    $('discard-title').textContent = 'Discard unsaved changes to ' + countryName(form.code) + '?';
    dialog.showModal();
    $('keep-editing').focus();
  }

  function selectCountry(code) {
    if (code === selected) return;
    guard(() => {
      selected = code;
      countries = loadCountries();
      loadForm(code);
      clearBanners();
      renderAll();
      $('tab-' + code).focus();
    });
  }

  function switchRole() {
    toggleMenu(false);
    guard(() => {
      role = role === 'admin' ? 'viewer' : 'admin';
      loadForm(selected);
      clearBanners();
      renderAll();
      $('account-button').focus();
    });
  }

  // Another tab (or the Tools panel) saved: refresh without losing unsaved edits.
  function onExternalUpdate() {
    countries = loadCountries();
    history = loadHistory();
    const c = countries[selected];
    if (form && c.version !== form.loadedVersion) {
      const name = countryName(selected);
      if (!isDirty()) {
        loadForm(selected, true);
        fillForm();
        renderStep1();
        banner($('top-notice'), 'info', name + ' was updated by another admin.');
      } else {
        banner($('top-notice'), 'warn', name + ' was just updated by another admin. Your next save will be blocked until you reload.');
      }
    }
    renderTabs();
    renderLastChanged();
    renderHistory();
    update();
  }

  // ---------- Wiring ----------

  function init() {
    $('chips').innerHTML = L.WEEKDAYS.map((d) =>
      '<button type="button" class="chip" data-day="' + d + '" aria-pressed="false" aria-label="' + L.WEEKDAY_NAMES[d] + '">' + d + '</button>').join('');

    // Number fields: live update; errors appear after leaving the field.
    NUM_FIELDS.forEach((f) => {
      const input = $('in-' + f);
      input.addEventListener('input', () => {
        form.values[f] = input.value;
        if ($('save-banner').querySelector('.banner-success')) banner($('save-banner'), '', '');
        update();
      });
      input.addEventListener('blur', () => {
        form.touched.add(f);
        if (f === 'longestExtension' && form.values.approvalThreshold.trim() !== '') form.touched.add('approvalThreshold');
        update();
      });
    });
    document.querySelectorAll('input[name=arrival]').forEach((r) => r.addEventListener('change', () => {
      form.values.arrivalCountsAsDay1 = r.value === 'yes';
      update();
    }));
    const setExcluded = (days) => {
      form.values.excludedWeekdays = L.WEEKDAYS.filter((d) => days.indexOf(d) !== -1);
      form.touched.add('excludedWeekdays');
      update();
    };
    $('chips').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const ex = form.values.excludedWeekdays;
      const d = b.dataset.day;
      setExcluded(ex.indexOf(d) === -1 ? ex.concat([d]) : ex.filter((x) => x !== d));
    });
    $('preset-weekends').addEventListener('click', () => setExcluded(['Sat', 'Sun']));
    $('preset-none').addEventListener('click', () => setExcluded([]));
    $('rules-form').addEventListener('submit', (e) => e.preventDefault());

    $('pv-arrival').value = nextFriday();
    $('pv-arrival').addEventListener('input', renderPreview);
    $('pv-days').addEventListener('input', renderPreview);

    $('in-reason').addEventListener('input', () => {
      reason = $('in-reason').value;
      renderFieldStates();
    });
    $('in-reason').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    $('save-button').addEventListener('click', save);
    $('discard-button').addEventListener('click', discard);
    $('error-summary').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-target]');
      if (!a) return;
      e.preventDefault();
      const t = focusTarget(a.dataset.target);
      if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); }
    });

    // Tabs: arrow keys move focus, Enter/Space or click selects.
    $('tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (t) selectCountry(t.id.slice(4));
    });
    $('tabs').addEventListener('keydown', (e) => {
      const tabs = Array.from(document.querySelectorAll('.tab'));
      const i = tabs.indexOf(document.activeElement);
      if (i === -1) return;
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j !== null) {
        e.preventDefault();
        tabs.forEach((t, k) => { t.tabIndex = k === j ? 0 : -1; });
        tabs[j].focus();
      }
    });

    // Account menu
    $('account-button').addEventListener('click', () => toggleMenu());
    $('account-switch').addEventListener('click', switchRole);
    document.addEventListener('click', (e) => {
      if (!$('account-menu').hidden && !e.target.closest('.account')) toggleMenu(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('account-menu').hidden) { toggleMenu(false); $('account-button').focus(); }
    });

    // Discard dialog
    $('keep-editing').addEventListener('click', () => { pendingAction = null; $('discard-dialog').close(); });
    $('confirm-discard').addEventListener('click', () => {
      const action = pendingAction;
      pendingAction = null;
      $('discard-dialog').close();
      form.values = toValues(form.baseline);
      if (action) action();
    });

    // History
    $('all-countries').addEventListener('change', renderHistory);
    $('history').addEventListener('click', (e) => {
      const b = e.target.closest('[data-restore]');
      if (b) restore(b.dataset.restore);
    });

    // Unsaved bar
    $('review-button').addEventListener('click', () => {
      $('step-3').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => $('in-reason').focus({ preventScroll: true }), 300);
    });
    window.addEventListener('beforeunload', (e) => {
      if (!leaving && isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });

    // Other tabs
    window.addEventListener('storage', (e) => {
      if (e.key === null || e.key === KEYS.countries) onExternalUpdate();
      else if (e.key === KEYS.history) { history = loadHistory(); renderHistory(); }
    });

    // Tools, only with ?demo=1
    if (params.get('demo') === '1') {
      $('tools').hidden = false;
      $('tool-simulate').addEventListener('click', () => {
        const c = loadCountries()[selected];
        const next = cloneSettings(c.settings);
        next.freeDays = c.settings.freeDays < 30 ? c.settings.freeDays + 1 : c.settings.freeDays - 1;
        const res = commitChange(selected, next, 'Updated the free days', OTHER_ADMIN, 'admin', { changedOnly: true });
        if (res.ok) onExternalUpdate();
      });
      $('tool-reset').addEventListener('click', () => {
        clearStored();
        leaving = true;
        window.location.reload();
      });
    }

    loadForm(selected);
    renderAll();
  }

  init();
})();
