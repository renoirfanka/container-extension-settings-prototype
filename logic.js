/*
 * Container extension request platform: per-country rules logic.
 *
 * Pure functions only (no page code). Works in the browser via a <script> tag
 * (exposed as window.ExtensionLogic) and in Node via require('./logic.js').
 *
 * Dates are "YYYY-MM-DD" strings, calculated in UTC so daylight-saving
 * changes can never shift a day.
 *
 * Settings object:
 *   { freeDays, longestExtension, extensionsAllowed, approvalThreshold,
 *     excludedWeekdays: ['Sat', 'Sun'], arrivalCountsAsDay1: true | false }
 * Number fields may be a number, null (empty) or a string the person typed
 * that is not a whole number.
 */
(function (root) {
  'use strict';

  var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var WEEKDAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday',
    Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  var FIELDS = ['freeDays', 'arrivalCountsAsDay1', 'excludedWeekdays',
    'longestExtension', 'extensionsAllowed', 'approvalThreshold'];

  var LABELS = {
    freeDays: 'Free days',
    arrivalCountsAsDay1: 'Counting starts',
    excludedWeekdays: "Days that don't count",
    longestExtension: 'Longest extension',
    extensionsAllowed: 'Extensions allowed',
    approvalThreshold: 'Approval needed above'
  };

  // ---------- Dates ----------

  function parseDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function addDays(iso, days) {
    var d = parseDate(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function weekdayOf(iso) {
    // getUTCDay: 0 = Sunday. Convert to a Monday-first index into WEEKDAYS.
    return WEEKDAYS[(parseDate(iso).getUTCDay() + 6) % 7];
  }

  // "Fri 5 June 2026"
  function formatDate(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return weekdayOf(iso) + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // "Fri 5 Jun 2026"
  function formatShortDate(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return weekdayOf(iso) + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCFullYear();
  }

  // ---------- Calculations ----------

  /*
   * Free-day due date.
   * Start on the arrival day (if it counts as day 1) or the day after.
   * Walk forward one calendar day at a time, skipping excluded weekdays;
   * the due date is the day on which the count reaches freeDays.
   * Returns an ISO date, or null if it cannot be calculated.
   */
  function freeDayDueDate(arrivalISO, freeDays, arrivalCountsAsDay1, excludedWeekdays) {
    var excluded = excludedWeekdays || [];
    if (!parseDate(arrivalISO)) return null;
    if (!Number.isInteger(freeDays) || freeDays < 1) return null;
    if (allExcluded(excluded)) return null;

    var day = arrivalCountsAsDay1 ? arrivalISO : addDays(arrivalISO, 1);
    var count = 0;
    for (;;) {
      if (excluded.indexOf(weekdayOf(day)) === -1) {
        count += 1;
        if (count === freeDays) return day;
      }
      day = addDays(day, 1);
    }
  }

  /*
   * Extension: new deadline = free-day due date + requested calendar days
   * (no days are skipped). Rejected if requested days exceed the longest extension.
   */
  function extendDeadline(deadlineISO, requestedDays, longestExtension) {
    if (!parseDate(deadlineISO)) return { ok: false, message: 'No free-day due date to extend.' };
    if (!Number.isInteger(requestedDays) || requestedDays < 1) {
      return { ok: false, message: 'Enter how many extra days the importer asks for.' };
    }
    if (!Number.isInteger(longestExtension)) {
      return { ok: false, message: "Can't be worked out yet: Longest extension is missing." };
    }
    if (requestedDays > longestExtension) {
      return { ok: false, rejected: true,
        message: 'Not allowed: ' + requestedDays + ' days is more than the longest extension (' + longestExtension + ' days).' };
    }
    return { ok: true, deadline: addDays(deadlineISO, requestedDays) };
  }

  /*
   * Day-by-day strip: one cell per calendar day from arrival to the last day shown.
   * Uses freeDayDueDate and extendDeadline so the strip and the dates always agree.
   * Cell: { date, weekday, day (date number), state, n, arrival }
   *   state: 'arrival' (arrival day that is not a free day), 'free', 'excluded', 'extra'
   *   n: running number for 'free' and 'extra' cells
   * extraDays may be 0, or rejected/invalid, in which case only the free days are shown.
   */
  function buildDayStrip(arrivalISO, settings, extraDays, maxCells) {
    var max = maxCells || 45;
    var excluded = settings.excludedWeekdays || [];
    var due = freeDayDueDate(arrivalISO, settings.freeDays, settings.arrivalCountsAsDay1, excluded);
    if (!due) return null;

    var last = due;
    var ext = extendDeadline(due, extraDays, settings.longestExtension);
    if (ext.ok) last = ext.deadline;

    var cells = [];
    var free = 0;
    var extra = 0;
    var start = settings.arrivalCountsAsDay1 ? arrivalISO : addDays(arrivalISO, 1);
    for (var day = arrivalISO; day <= last && cells.length < max; day = addDays(day, 1)) {
      var cell = { date: day, weekday: weekdayOf(day), day: parseDate(day).getUTCDate(),
        state: 'arrival', n: null, arrival: day === arrivalISO };
      if (day > due) {
        extra += 1;
        cell.state = 'extra';
        cell.n = extra;
      } else if (day >= start) {
        if (excluded.indexOf(cell.weekday) !== -1) {
          cell.state = 'excluded';
        } else {
          free += 1;
          cell.state = 'free';
          cell.n = free;
        }
      }
      cells.push(cell);
    }
    return { cells: cells, due: due, deadline: ext.ok ? ext.deadline : null,
      truncated: addDays(arrivalISO, cells.length - 1) < last };
  }

  // ---------- Validation ----------

  function allExcluded(excluded) {
    return WEEKDAYS.every(function (w) { return excluded.indexOf(w) !== -1; });
  }

  // Reads a value that should be a whole number. Accepts numbers, numeric strings and blanks.
  function readWhole(v) {
    if (v === null || v === undefined || String(v).trim() === '') return { blank: true };
    var s = String(v).trim();
    if (!/^\d+$/.test(s)) return { invalid: true };
    return { value: Number(s) };
  }

  var RANGES = {
    freeDays: { min: 1, max: 30, blank: 'Enter the number of free days.' },
    longestExtension: { min: 1, max: 60, blank: 'Enter the longest extension in days.' },
    extensionsAllowed: { min: 1, max: 5, blank: 'Enter how many extensions are allowed.' }
  };

  /*
   * Validates a full settings object. Returns a list of { field, message, blank }.
   * Blank required fields are errors; a blank approval threshold is valid.
   */
  function validateSettings(s) {
    var errors = [];

    ['freeDays', 'longestExtension', 'extensionsAllowed'].forEach(function (field) {
      var range = RANGES[field];
      var r = readWhole(s[field]);
      if (r.blank) {
        errors.push({ field: field, blank: true, message: range.blank });
      } else if (r.invalid || r.value < range.min || r.value > range.max) {
        errors.push({ field: field, message: 'Enter a whole number from ' + range.min + ' to ' + range.max + '.' });
      }
    });

    var t = readWhole(s.approvalThreshold);
    if (t.invalid || t.value === 0) {
      errors.push({ field: 'approvalThreshold', message: 'Enter a whole number, or leave this empty.' });
    } else if (!t.blank) {
      var longest = readWhole(s.longestExtension);
      if (longest.value !== undefined && t.value >= longest.value) {
        errors.push({ field: 'approvalThreshold',
          message: 'Must be lower than the longest extension (' + longest.value + ' days), or approval would never be needed.' });
      }
    }

    if (allExcluded(s.excludedWeekdays || [])) {
      errors.push({ field: 'excludedWeekdays', message: 'At least one day must still count. Untick a day.' });
    }

    if (s.arrivalCountsAsDay1 !== true && s.arrivalCountsAsDay1 !== false) {
      errors.push({ field: 'arrivalCountsAsDay1', blank: true, message: 'Choose when counting starts.' });
    }

    return errors;
  }

  // ---------- Plain-language descriptions ----------

  function sameValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      return WEEKDAYS.filter(function (w) { return a.indexOf(w) !== -1; }).join() ===
        WEEKDAYS.filter(function (w) { return b.indexOf(w) !== -1; }).join();
    }
    var ra = readWhole(a), rb = readWhole(b);
    if (typeof a !== 'boolean' && typeof b !== 'boolean' && !ra.invalid && !rb.invalid) {
      return ra.value === rb.value;
    }
    return a === b;
  }

  // Readable value, e.g. "6", "On arrival day", "Saturday, Sunday", "none".
  function displayValue(field, v) {
    if (field === 'excludedWeekdays') {
      var days = WEEKDAYS.filter(function (w) { return (v || []).indexOf(w) !== -1; });
      return days.length ? days.map(function (w) { return WEEKDAY_NAMES[w]; }).join(', ') : 'none';
    }
    if (field === 'arrivalCountsAsDay1') {
      return v === true ? 'On arrival day' : v === false ? 'Day after arrival' : 'not set';
    }
    if (v === null || v === undefined || String(v).trim() === '') {
      return field === 'approvalThreshold' ? 'none' : 'empty';
    }
    return String(v).trim();
  }

  // Lists the settings that differ between two settings objects, in plain words.
  function listChanges(before, after) {
    return FIELDS.filter(function (f) { return !sameValue(before[f], after[f]); }).map(function (f) {
      var from = displayValue(f, before[f]);
      var to = displayValue(f, after[f]);
      return { field: f, label: LABELS[f], from: from, to: to, text: LABELS[f] + ': ' + from + ' → ' + to };
    });
  }

  // "Free days changed from 5 to 6"
  function describeChange(field, from, to) {
    return LABELS[field] + ' changed from ' + displayValue(field, from) + ' to ' + displayValue(field, to);
  }

  // "Saturday and Sunday won't use up free days."
  function excludedSentence(excluded) {
    var days = WEEKDAYS.filter(function (w) { return (excluded || []).indexOf(w) !== -1; })
      .map(function (w) { return WEEKDAY_NAMES[w]; });
    if (!days.length) return 'Every day counts as a free day.';
    if (days.length === 7) return 'No day would count as a free day.';
    var list = days.length === 1 ? days[0]
      : days.slice(0, -1).join(', ') + ' and ' + days[days.length - 1];
    return list + " won't use up free days.";
  }

  var api = {
    WEEKDAYS: WEEKDAYS,
    WEEKDAY_NAMES: WEEKDAY_NAMES,
    FIELDS: FIELDS,
    LABELS: LABELS,
    parseDate: parseDate,
    addDays: addDays,
    weekdayOf: weekdayOf,
    formatDate: formatDate,
    formatShortDate: formatShortDate,
    freeDayDueDate: freeDayDueDate,
    extendDeadline: extendDeadline,
    buildDayStrip: buildDayStrip,
    readWhole: readWhole,
    validateSettings: validateSettings,
    sameValue: sameValue,
    displayValue: displayValue,
    listChanges: listChanges,
    describeChange: describeChange,
    excludedSentence: excludedSentence
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExtensionLogic = api;
})(this);
