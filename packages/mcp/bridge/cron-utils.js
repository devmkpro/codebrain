"use strict";

// cron-utils — Lightweight cron scheduling utilities.
//
// Ported from Overclock @overclock-app/core.
// Self-contained: no npm deps. Supports standard 5-field cron expressions.
//
// Fields: minute hour day-of-month month day-of-week
// Special chars: * (any), comma lists, ranges (-), steps (/)
//
// Stale threshold: jobs overdue by >5min are skipped (handles laptop-closed).

const CRON_STALE_MS = 5 * 60 * 1000; // 5 minutes

// Parse a cron field into a sorted Set of valid values.
// Supports: *, N, N-M, N-M/S, */S
function parseCronField(field, min, max) {
  const values = new Set();

  for (const part of field.split(",")) {
    // Handle step: */2 or 1-5/2
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const base = stepMatch ? stepMatch[1] : part;

    if (base === "*") {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (base.includes("-")) {
      const [lo, hi] = base.split("-").map(Number);
      for (let i = lo; i <= hi; i += step) values.add(i);
    } else {
      values.add(parseInt(base, 10));
    }
  }

  return values;
}

// Parse a 5-field cron expression into its component sets.
// Example: "0 9 * * 1-5" = weekdays at 9am
function parseCronExpression(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Invalid cron expression: expected 5 fields, got " + parts.length);
  }

  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    days: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    weekdays: parseCronField(parts[4], 0, 6), // 0=Sunday
  };
}

// Check if a Date matches the parsed cron schedule.
function matchesSchedule(date, schedule) {
  return (
    schedule.minutes.has(date.getMinutes()) &&
    schedule.hours.has(date.getHours()) &&
    schedule.days.has(date.getDate()) &&
    schedule.months.has(date.getMonth() + 1) &&
    schedule.weekdays.has(date.getDay())
  );
}

// Calculate the next fire time after `after` for a cron expression.
// Searches minute-by-minute for up to 2 years (avoid infinite loop).
// Returns Unix timestamp ms or null if not found.
function nextCronAfter(cronExpr, after) {
  try {
    const schedule = parseCronExpression(cronExpr);
    const start = new Date(after + 60_000); // Start from next minute
    start.setSeconds(0, 0);

    const maxDate = new Date(after + 2 * 365 * 24 * 60 * 60 * 1000); // 2 years
    const current = new Date(start);

    while (current < maxDate) {
      if (matchesSchedule(current, schedule)) {
        return current.getTime();
      }
      current.setMinutes(current.getMinutes() + 1);
    }

    return null;
  } catch {
    return null;
  }
}

// Determine if a cron job should fire right now.
// Criteria: status=active, nextFireAt in the past, NOT stale (>5min overdue).
function shouldFireJob(job, now) {
  if (job.status !== "active") return false;
  if (job.nextFireAt == null) return false;
  if (job.nextFireAt > now) return false;
  // Stale check: if overdue by more than 5min, skip (don't fire a catch-up storm)
  const overdueMs = now - job.nextFireAt;
  if (overdueMs > CRON_STALE_MS) return false;
  return true;
}

// Check if a job is stale (overdue by > CRON_STALE_MS).
function isStaleJob(job, now) {
  if (job.status !== "active") return false;
  if (job.nextFireAt == null) return false;
  const overdueMs = now - job.nextFireAt;
  return overdueMs > CRON_STALE_MS;
}

module.exports = {
  CRON_STALE_MS,
  parseCronField,
  parseCronExpression,
  matchesSchedule,
  nextCronAfter,
  shouldFireJob,
  isStaleJob,
};
