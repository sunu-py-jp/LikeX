import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const output = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['src/model-entry.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { createCalendar, normalizeCalendar, parseCalendar, serializeCalendar, executeCalendarCommands: execute, getCalendarVisibleRange, getCalendarEvents, createCalendarRescheduleCommand, calendarLocalTimeToISO, getCalendarLocalDateTime } = api;
const meeting = { id: 'meeting', title: 'Review', allDay: false, start: '2026-09-22T09:00:00+09:00', end: '2026-09-22T10:00:00+09:00' };
const holiday = { id: 'holiday', title: 'Leave', allDay: true, start: '2026-09-23', end: '2026-09-25' };
const sample = () => createCalendar({ id: 'cal', timeZone: 'Asia/Tokyo', events: [meeting, holiday] });
test('frozen detached model and native JSON roundtrip preserve IDs, offsets and ordering', () => {
  const input = structuredClone(sample()), calendar = normalizeCalendar(input); input.events[0].title = 'external';
  assert.equal(calendar.events[0].title, 'Review'); assert.ok(Object.isFrozen(calendar.events[0]));
  assert.equal(normalizeCalendar(calendar), calendar);
  const serialized = serializeCalendar(calendar); assert.equal(serializeCalendar(parseCalendar(serialized)), serialized);
  assert.deepEqual(parseCalendar(serialized), calendar); assert.equal(typeof globalThis.window, 'undefined');
});
test('commands create update delete and metadata updates are immutable and atomic', () => {
  const original = sample(), changed = execute(original, [{ type: 'event.update', id: 'meeting', changes: { title: 'Updated' } }, { type: 'event.create', event: { ...holiday, id: 'second' } }, { type: 'calendar.update', title: 'Team' }]);
  assert.equal(changed.calendar.events[0].title, 'Updated'); assert.equal(original.events[0].title, 'Review'); assert.equal(changed.calendar.events.length, 3);
  assert.equal(execute(changed.calendar, { type: 'event.delete', id: 'second' }).calendar.events.length, 2);
  const json = serializeCalendar(original);
  assert.throws(() => execute(original, [{ type: 'calendar.update', title: 'partial' }, { type: 'event.delete', id: 'missing' }]));
  assert.equal(serializeCalendar(original), json);
  assert.equal(execute(original, { type: 'event.update', id: 'meeting', changes: { title: 'Review' } }).changed, false);
});
test('invalid input including recurrence, local timestamps, duplicate IDs and date rollover is rejected', () => {
  for (const changes of [{ start: '2026-09-22T09:00' }, { start: '2026-02-30T09:00:00Z' }, { end: meeting.start }, { allDay: 'yes' }, { color: 'red' }, { recurrence: 'daily' }]) assert.throws(() => createCalendar({ events: [{ ...meeting, ...changes }] }));
  assert.throws(() => createCalendar({ events: [meeting, meeting] }));
  assert.throws(() => normalizeCalendar({ ...sample(), version: 2 }));
  assert.throws(() => createCalendar({ timeZone: 'No/Zone' }));
  assert.throws(() => createCalendar({ timeZone: '+09:00' }));
  assert.throws(() => execute(sample(), { type: 'event.update', id: 'meeting', changes: { id: 'hijacked' } }));
  assert.throws(() => parseCalendar(' '.repeat(api.CALENDAR_MAX_JSON_BYTES + 1)));
});
test('month/week/day ranges include real weekday padding and exclusive endpoints', () => {
  assert.deepEqual(getCalendarVisibleRange('2026-09-22', 'month', 'UTC'), { start: '2026-08-31', end: '2026-10-05', view: 'month', timeZone: 'UTC' });
  assert.equal(getCalendarVisibleRange('2026-09-22', 'week', 'UTC').start, '2026-09-21');
  assert.equal(getCalendarVisibleRange('2026-09-22', 'day', 'UTC').end, '2026-09-23');
  assert.equal(getCalendarVisibleRange('2026-02-01', 'month', 'UTC', 0).end, '2026-03-01');
});
test('range queries use display zone and all-day exclusive ends', () => {
  assert.deepEqual(getCalendarEvents(sample(), { start: '2026-09-24', end: '2026-09-25' }).map(item => item.id), ['holiday']);
  assert.equal(getCalendarEvents(sample(), { start: '2026-09-25', end: '2026-09-26' }).length, 0);
  const west = createCalendar({ timeZone: 'America/Los_Angeles', events: [meeting] });
  assert.equal(getCalendarEvents(west, { start: '2026-09-21', end: '2026-09-22' }).length, 1);
});
test('DST gaps reject and ambiguous local times resolve to earlier instant', () => {
  assert.throws(() => calendarLocalTimeToISO('2026-03-08T02:30', 'America/New_York'), /does not exist/);
  assert.equal(calendarLocalTimeToISO('2026-11-01T01:30', 'America/New_York'), '2026-11-01T05:30:00.000Z');
  assert.equal(calendarLocalTimeToISO('2026-09-22T09:30', 'Asia/Tokyo'), '2026-09-22T00:30:00.000Z');
});
test('rescheduling preserves duration across DST and all-day day counts', () => {
  const original = createCalendar({ timeZone: 'America/New_York', events: [{ ...meeting, start: '2026-03-07T09:00:00-05:00', end: '2026-03-07T10:30:00-05:00' }, holiday] });
  const moved = execute(original, createCalendarRescheduleCommand(original, 'meeting', '2026-03-08')).calendar.events[0];
  assert.equal(getCalendarLocalDateTime(moved.start, original.timeZone), '2026-03-08T09:00:00');
  assert.equal(Date.parse(moved.end) - Date.parse(moved.start), 90 * 60000);
  const day = execute(original, createCalendarRescheduleCommand(original, 'holiday', '2026-10-01')).calendar.events[1];
  assert.equal(day.end, '2026-10-03');
});
test('formatted serialization stays within parser byte bound and commands have a separate batch bound', () => {
  const original = sample();
  assert.throws(() => execute(original, Array.from({ length: api.CALENDAR_MAX_COMMANDS + 1 }, () => ({ type: 'calendar.update', title: 'Too many' }))), /Too many/);
  const raw = { ...original, events: Array.from({ length: 516 }, (_, index) => ({ ...meeting, id: `event-${index}`, description: 'x'.repeat(10000) })) };
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) < api.CALENDAR_MAX_JSON_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(raw, null, 2) + '\n') > api.CALENDAR_MAX_JSON_BYTES);
  assert.throws(() => normalizeCalendar(raw), /size limit/);
});

test('resize helper preserves ID and opposite boundary, validates ordering and DST', () => {
  const original = sample();
  const end = api.createCalendarResizeCommand(original, 'meeting', 'end', '2026-09-22', '11:30');
  const expanded = execute(original, end).calendar;
  assert.equal(expanded.events[0].start, meeting.start);
  assert.equal(expanded.events[0].end, '2026-09-22T02:30:00.000Z');
  assert.equal(expanded.events[0].id, 'meeting');
  const start = api.createCalendarResizeCommand(original, 'meeting', 'start', '2026-09-22', '08:15');
  assert.equal(execute(original, start).calendar.events[0].end, meeting.end);
  assert.throws(() => api.createCalendarResizeCommand(original, 'meeting', 'end', '2026-09-22', '09:00'), /終了/);
  assert.throws(() => api.createCalendarResizeCommand(original, 'holiday', 'end', '2026-09-25', '11:00'), /all-day/);
  assert.throws(() => api.createCalendarResizeCommand(original, 'missing', 'end', '2026-09-22', '11:00'), /Unknown/);
  const dst = createCalendar({ timeZone: 'America/New_York', events: [{...meeting, start:'2026-03-08T01:00:00-05:00',end:'2026-03-08T04:00:00-04:00'}] });
  assert.throws(() => api.createCalendarResizeCommand(dst,'meeting','start','2026-03-08','02:30'), /exist/);
  assert.equal(original.events[0], original.events[0]);
});
