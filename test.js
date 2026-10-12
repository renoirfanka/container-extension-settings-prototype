// Run with: node test.js
// Checks the calculation and validation logic against the worked examples.
var L = require('./logic.js');

var COUNTRY_A = { freeDays: 5, longestExtension: 14, extensionsAllowed: 2, approvalThreshold: null,
  excludedWeekdays: [], arrivalCountsAsDay1: true };
var COUNTRY_D = { freeDays: 3, longestExtension: null, extensionsAllowed: null, approvalThreshold: 7,
  excludedWeekdays: ['Sat', 'Sun'], arrivalCountsAsDay1: false };

function withChanges(base, changes) { return Object.assign({}, base, changes); }
function errorFields(settings) {
  return L.validateSettings(settings).map(function (e) { return e.field; }).sort().join(', ');
}
function due(arrival, freeDays, counts, excluded) {
  return L.formatDate(L.freeDayDueDate(arrival, freeDays, counts, excluded));
}

var CHECKS = [
  { id: 'T1', setup: 'Country A settings, arrival Mon 1 June, then a 4-day extension',
    expected: 'Free days end Fri 5 June 2026; after extension Tue 9 June 2026',
    run: function () {
      var d = L.freeDayDueDate('2026-06-01', 5, true, []);
      var ext = L.extendDeadline(d, 4, 14);
      return 'Free days end ' + L.formatDate(d) + '; after extension ' + (ext.ok ? L.formatDate(ext.deadline) : ext.message);
    } },
  { id: 'T2a', setup: 'Country B settings (7 free days), arrival Mon 1 June',
    expected: 'Sun 7 June 2026', run: function () { return due('2026-06-01', 7, true, []); } },
  { id: 'T2b', setup: 'Country C settings (3 free days), arrival Mon 1 June',
    expected: 'Wed 3 June 2026', run: function () { return due('2026-06-01', 3, true, []); } },
  { id: 'T3', setup: 'Country D: arrival Fri 5 June, 3 free days, Sat and Sun excluded, arrival day does not count',
    expected: 'Wed 10 June 2026', run: function () { return due('2026-06-05', 3, false, ['Sat', 'Sun']); } },
  { id: 'T4', setup: 'Same settings as T3, arrival Sat 6 June',
    expected: 'Wed 10 June 2026', run: function () { return due('2026-06-06', 3, false, ['Sat', 'Sun']); } },
  { id: 'T5', setup: 'Approval threshold 14 with longest extension 14',
    expected: 'Errors on: approvalThreshold',
    run: function () { return 'Errors on: ' + errorFields(withChanges(COUNTRY_A, { approvalThreshold: 14 })); } },
  { id: 'T6', setup: 'All seven weekdays excluded',
    expected: 'Errors on: excludedWeekdays',
    run: function () { return 'Errors on: ' + errorFields(withChanges(COUNTRY_A, { excludedWeekdays: L.WEEKDAYS.slice() })); } },
  { id: 'T7', setup: 'Country D as seeded',
    expected: 'Errors on: extensionsAllowed, longestExtension',
    run: function () { return 'Errors on: ' + errorFields(COUNTRY_D); } },
  { id: 'T8', setup: 'Extension of 11 days with longest extension 10',
    expected: 'Request rejected',
    run: function () { return L.extendDeadline('2026-06-07', 11, 10).rejected ? 'Request rejected' : 'Allowed'; } },
  { id: 'T9', setup: 'Day strip for T3 with a 2-day extension',
    expected: 'Fri 5 arrival, Sat 6 excluded, Sun 7 excluded, Mon 8 free 1, Tue 9 free 2, Wed 10 free 3, Thu 11 extra 1, Fri 12 extra 2',
    run: function () {
      // Country D's longest extension is empty as seeded; T9 needs one so the 2 extra days are allowed.
      var strip = L.buildDayStrip('2026-06-05', withChanges(COUNTRY_D, { longestExtension: 10 }), 2, 45);
      return strip.cells.map(function (c) {
        return c.weekday + ' ' + c.day + ' ' + c.state + (c.n ? ' ' + c.n : '');
      }).join(', ');
    } },

  // Extra checks on the exact wording shown on the page.
  { id: 'M1', setup: 'Blank free days message',
    expected: 'Enter the number of free days.',
    run: function () { return L.validateSettings(withChanges(COUNTRY_A, { freeDays: '' }))[0].message; } },
  { id: 'M2', setup: 'Approval threshold not lower than the longest extension',
    expected: 'Must be lower than the longest extension (14 days), or approval would never be needed.',
    run: function () { return L.validateSettings(withChanges(COUNTRY_A, { approvalThreshold: 20 }))[0].message; } },
  { id: 'M3', setup: 'Rejected extension message',
    expected: 'Not allowed: 11 days is more than the longest extension (10 days).',
    run: function () { return L.extendDeadline('2026-06-07', 11, 10).message; } },
  { id: 'M4', setup: 'Change summary in plain words',
    expected: "Free days: 5 → 6 | Counting starts: On arrival day → Day after arrival | Days that don't count: none → Saturday, Sunday",
    run: function () {
      return L.listChanges(COUNTRY_A, withChanges(COUNTRY_A, { freeDays: 6, arrivalCountsAsDay1: false, excludedWeekdays: ['Sat', 'Sun'] }))
        .map(function (c) { return c.text; }).join(' | ');
    } },
  { id: 'M5', setup: 'Sentence under the weekday chips',
    expected: "Saturday and Sunday won't use up free days. / Every day counts as a free day. / Monday won't use up free days.",
    run: function () {
      return [['Sat', 'Sun'], [], ['Mon']].map(L.excludedSentence).join(' / ');
    } }
];

var failed = 0;
CHECKS.forEach(function (c) {
  var actual;
  try { actual = c.run(); } catch (e) { actual = 'Error: ' + e.message; }
  var pass = actual === c.expected;
  if (!pass) failed += 1;
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + c.id + '  ' + c.setup);
  if (!pass) {
    console.log('      expected: ' + c.expected);
    console.log('      actual:   ' + actual);
  }
});
console.log('\n' + (CHECKS.length - failed) + ' of ' + CHECKS.length + ' passed.');
process.exitCode = failed ? 1 : 0;
