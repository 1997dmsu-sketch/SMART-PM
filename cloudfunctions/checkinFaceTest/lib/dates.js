'use strict';

/**
 * Asia/Shanghai wall-clock date handling for the test lease.
 *
 * All persisted boundaries are literal local wall-clock strings produced from
 * the负责人手填的 YYYY-MM-DD values. No UTC offset, no `+1 day`, no duration
 * fallback and no "today" default is used anywhere in this module.
 */

const TIMEZONE = 'Asia/Shanghai';
const DAILY_HOURS = '24x7';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** @returns {boolean} true when the year is a Gregorian leap year. */
function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Parse a strict, manually entered calendar date.
 * @param {unknown} value YYYY-MM-DD string.
 * @returns {string} the normalized date string.
 * @throws {Error} when the value is not a real calendar date.
 */
function parseCalendarDate(value) {
  if (typeof value !== 'string') throw new Error('INVALID_DATE');
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error('INVALID_DATE');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970 || year > 9999 || month < 1 || month > 12) throw new Error('INVALID_DATE');
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) throw new Error('INVALID_DATE');
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** @returns {{year:string,month:string,day:string,hour:string,minute:string,second:string}} Shanghai parts. */
function shanghaiParts(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('INVALID_TIME');
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

/** @returns {string} Shanghai wall clock as YYYY-MM-DDTHH:mm:ss. */
function shanghaiDateTime(now = new Date()) {
  const p = shanghaiParts(now);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** @returns {string} Shanghai calendar date as YYYY-MM-DD. */
function shanghaiDate(now = new Date()) {
  return shanghaiDateTime(now).slice(0, 10);
}

/**
 * Map the manual start/end dates to inclusive device boundaries.
 * @returns {{startDate:string,endDate:string,validFrom:string,validTo:string,timezone:string,dailyHours:string}}
 */
function buildLeaseWindow(startDate, endDate) {
  const start = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);
  if (start > end) throw new Error('INVALID_DATE_RANGE');
  return {
    startDate: start,
    endDate: end,
    validFrom: `${start}T00:00:00`,
    validTo: `${end}T23:59:59`,
    timezone: TIMEZONE,
    dailyHours: DAILY_HOURS,
  };
}

/**
 * Check whether a wall-clock string matches a generated snapshot exactly.
 * @param {{validFrom?:unknown,validTo?:unknown,startDate?:unknown,endDate?:unknown,timezone?:unknown,dailyHours?:unknown}} snapshot
 * @returns {boolean}
 */
function isValidWindowSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  try {
    const expected = buildLeaseWindow(snapshot.startDate, snapshot.endDate);
    return snapshot.validFrom === expected.validFrom
      && snapshot.validTo === expected.validTo
      && snapshot.timezone === TIMEZONE
      && snapshot.dailyHours === DAILY_HOURS
      && DATE_TIME_PATTERN.test(snapshot.validFrom)
      && DATE_TIME_PATTERN.test(snapshot.validTo);
  } catch {
    return false;
  }
}

/**
 * Inclusive test: [validFrom, validTo] in Shanghai wall-clock strings.
 * @returns {boolean}
 */
function isWithinWindow(window, now = new Date()) {
  if (!isValidWindowSnapshot(window)) return false;
  const current = shanghaiDateTime(now);
  return current >= window.validFrom && current <= window.validTo;
}

module.exports = {
  TIMEZONE,
  DAILY_HOURS,
  DATE_PATTERN,
  DATE_TIME_PATTERN,
  isLeapYear,
  parseCalendarDate,
  shanghaiParts,
  shanghaiDateTime,
  shanghaiDate,
  buildLeaseWindow,
  isValidWindowSnapshot,
  isWithinWindow,
};
