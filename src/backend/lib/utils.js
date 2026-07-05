import crypto from "node:crypto";

export function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function stableId(prefix, value) {
  const digest = crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
  return `${prefix}_${digest}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function includesAny(text, terms) {
  const haystack = String(text ?? "").toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

export function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

export function parseDate(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? new Date(time) : null;
}

export function inLastDays(value, days) {
  const date = parseDate(value);
  if (!date) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

export function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

export function nextDailyDelayMs(timezone, hour) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const currentLocal = new Date(localAsUtc);
  const targetLocal = new Date(localAsUtc);
  targetLocal.setUTCHours(hour, 0, 0, 0);
  if (targetLocal <= currentLocal) targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
  return targetLocal.getTime() - currentLocal.getTime();
}

export function summarizeList(items, limit = 8) {
  return items.slice(0, limit);
}
