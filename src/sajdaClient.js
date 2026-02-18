const axios = require("axios");
const { CITIES } = require("./cities");

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const TASHKENT_TZ = "Asia/Tashkent";
const RAMAZON_API_URL = process.env.RAMAZON_API_URL || "http://94.158.51.173:8080/ramazon/ramazon.php";

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const API_TIMEOUT_MS = toPositiveInt(process.env.API_TIMEOUT_MS, 15000);
const API_RETRY_COUNT = toPositiveInt(process.env.API_RETRY_COUNT, 3);
const API_RETRY_DELAY_MS = toPositiveInt(process.env.API_RETRY_DELAY_MS, 700);

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeKey(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['`’ʻ‘-]/g, "")
    .replace(/\s+/g, "");
}

function getDateInTashkent(offsetDays = 0) {
  const now = new Date();
  const target = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TASHKENT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(target);

  const lookup = {};
  parts.forEach((part) => {
    if (part.type !== "literal") lookup[part.type] = part.value;
  });

  return {
    isoDate: `${lookup.year}-${lookup.month}-${lookup.day}`,
    day: Number(lookup.day),
    month: Number(lookup.month),
  };
}

function buildRegionRowMap(list, apiDate) {
  const map = new Map();

  list.forEach((item) => {
    const region = String(item?.region || "").trim();
    const type = normalizeText(item?.type);
    const regionKey = normalizeKey(region);
    if (!regionKey) return;

    const row = map.get(regionKey) || {
      region,
      apiDate,
      saharlikEnd: null,
      iftor: null,
      saharlikDua: null,
      iftorDua: null,
    };

    if (type === "saharlik") {
      row.saharlikEnd = String(item?.t || "").trim() || null;
      row.saharlikDua = String(item?.duosi || "").trim() || null;
    } else if (type === "iftorlik") {
      row.iftor = String(item?.t || "").trim() || null;
      row.iftorDua = String(item?.duosi || "").trim() || null;
    }

    map.set(regionKey, row);
  });

  return map;
}

function findCityByKey(cityKey) {
  return CITIES.find((city) => city.key === cityKey) || null;
}

function findRowForCity(rowsByRegion, city) {
  if (!city) return null;

  const candidates = [city.apiRegion, city.name, ...(city.aliases || [])]
    .filter(Boolean)
    .map(normalizeKey);

  for (const key of candidates) {
    const row = rowsByRegion.get(key);
    if (row) return row;
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  if (!error) return false;
  const status = Number(error?.response?.status);
  if (status >= 500) return true;
  const code = String(error?.code || "").toUpperCase();
  return ["ECONNABORTED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code);
}

async function requestRamazonApi() {
  let lastError = null;
  for (let attempt = 1; attempt <= API_RETRY_COUNT; attempt += 1) {
    try {
      return await axios.get(RAMAZON_API_URL, {
        timeout: API_TIMEOUT_MS,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; ramadan-bot/2.0)",
        },
      });
    } catch (error) {
      lastError = error;
      const canRetry = attempt < API_RETRY_COUNT && isRetryableError(error);
      if (!canRetry) break;
      await sleep(API_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

async function fetchRamazonSchedule({ force = false } = {}) {
  const cacheKey = "ramazon-api";
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (!force && cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.payload;
  }

  const response = await requestRamazonApi();

  const data = response?.data;
  if (!data || data.status !== "success" || !Array.isArray(data.list)) {
    throw new Error("Ramazon API noto'g'ri format qaytardi");
  }

  const payload = {
    apiDate: String(data.date || "").trim() || null,
    count: Number(data.count || 0),
    rowsByRegion: buildRegionRowMap(data.list, String(data.date || "").trim() || null),
    fetchedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, { ts: now, payload });
  return payload;
}

async function fetchCitySchedule(cityKey, { force = false } = {}) {
  const city = findCityByKey(cityKey);
  if (!city) throw new Error(`Unknown city: ${cityKey}`);

  const schedule = await fetchRamazonSchedule({ force });
  const row = findRowForCity(schedule.rowsByRegion, city);
  if (!row) {
    throw new Error(`${city.name} uchun APIda jadval topilmadi`);
  }

  return {
    city,
    row,
    rows: [row],
    apiDate: schedule.apiDate,
    fetchedAt: schedule.fetchedAt,
  };
}

function pickDay(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[0] || null;
}

module.exports = {
  CITIES,
  CACHE_TTL_MS,
  fetchCitySchedule,
  fetchRamazonSchedule,
  getDateInTashkent,
  pickDay,
};
