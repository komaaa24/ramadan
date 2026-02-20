require("dotenv").config();
const { Bot, InlineKeyboard } = require("grammy");
const {
  CITIES,
  fetchCitySchedule,
  getDateInTashkent,
} = require("./sajdaClient");
const { initDb, closeDb, getUserRepo } = require("./db");

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is missing. Put it into .env (BOT_TOKEN=...).");
}

const bot = new Bot(token);
const TASHKENT_TZ = "Asia/Tashkent";
const NOTIFY_CHECK_INTERVAL_MS = 60 * 1000;
const SAHARLIK_NOTICE_WINDOW_START_MINUTES = 21 * 60;
const SAHARLIK_NOTICE_WINDOW_END_MINUTES = 21 * 60 + 5;
const IFTOR_NOTICE_WINDOW_START_MINUTES = 11 * 60;
const IFTOR_NOTICE_WINDOW_END_MINUTES = 11 * 60 + 5;
const DEFAULT_CITY_KEY = process.env.DEFAULT_CITY_KEY || "toshkent";

const TEST_MODE = process.env.TEST_MODE === "true";
const TEST_CHAT_ID = process.env.TEST_CHAT_ID || null;
const TEST_NOW_TIME = process.env.TEST_NOW_TIME || null;
const blockedChats = new Set();

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function chunk(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function buildCityKeyboard() {
  const keyboard = new InlineKeyboard();
  chunk(CITIES, 3).forEach((row) => {
    row.forEach((city, idx) => {
      keyboard.text(city.name, `city|${city.key}`);
      if (idx < row.length - 1) return;
      keyboard.row();
    });
  });
  return keyboard;
}

function buildCityActions(cityKey) {
  return new InlineKeyboard()
    .text("Bugungi jadval", `today|${cityKey}`)
    .text("Yangilash", `refresh|${cityKey}`)
    .row()
    .text("⬅️ Shaharlar", "cities");
}

function formatDayMessage(city, row, label) {
  if (!row) {
    return `📍 <b>${escapeHtml(city.name)}</b>\nJadval topilmadi.`;
  }

  return [
    `📍 <b>${escapeHtml(city.name)}</b> — ${escapeHtml(label)}`,
    `📅 Sana: <b>${escapeHtml(row.apiDate || "-")}</b>`,
    `🌙 Saharlik tugashi: <b>${escapeHtml(row.saharlikEnd || "-")}</b>`,
    `🌇 Iftorlik: <b>${escapeHtml(row.iftor || "-")}</b>`,
    "",
    `🤲 <b>Saharlik duosi</b>`,
    escapeHtml(row.saharlikDua || "-"),
    "",
    `🤲 <b>Iftorlik duosi</b>`,
    escapeHtml(row.iftorDua || "-"),
  ].join("\n");
}

function formatSaharlikReminder(city, row) {
  return [
    `🕘 <b>Ertangi saharlik vaqti</b>`,
    `📍 <b>${escapeHtml(city.name)}</b>`,
    `📅 Sana: <b>${escapeHtml(row.apiDate || "-")}</b>`,
    `⏰ Saharlik tugashi: <b>${escapeHtml(row.saharlikEnd || "-")}</b>`,
    "",
    `🤲 <b>Saharlik duosi</b>`,
    escapeHtml(row.saharlikDua || "-"),
  ].join("\n");
}

function formatIftorReminder(city, row) {
  return [
    `🌇 <b>Bugungi iftorlik vaqti</b>`,
    `📍 <b>${escapeHtml(city.name)}</b>`,
    `📅 Sana: <b>${escapeHtml(row.apiDate || "-")}</b>`,
    `⏰ Iftorlik: <b>${escapeHtml(row.iftor || "-")}</b>`,
    "",
    `🤲 <b>Iftorlik duosi</b>`,
    escapeHtml(row.iftorDua || "-"),
  ].join("\n");
}

function parseTimeToMinutes(value) {
  const match = String(value || "").match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function getNowInTashkent() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TASHKENT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const lookup = {};
  parts.forEach((part) => {
    if (part.type !== "literal") lookup[part.type] = part.value;
  });

  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);
  const isoDate = `${lookup.year}-${lookup.month}-${lookup.day}`;

  if (TEST_MODE && TEST_NOW_TIME) {
    const testMinutes = parseTimeToMinutes(TEST_NOW_TIME);
    if (Number.isFinite(testMinutes)) {
      return {
        isoDate,
        minutesOfDay: testMinutes,
      };
    }
  }

  return {
    isoDate,
    minutesOfDay: hour * 60 + minute,
  };
}

function getChatId(ctx) {
  return ctx.chat?.id ?? ctx.from?.id ?? null;
}

function findCityByKey(cityKey) {
  return CITIES.find((city) => city.key === cityKey) || CITIES.find((city) => city.key === DEFAULT_CITY_KEY) || CITIES[0];
}

async function upsertUserFromContext(ctx, updates = {}) {
  const chatId = getChatId(ctx);
  if (!chatId) return null;

  const repo = getUserRepo();
  const chatIdStr = String(chatId);
  const base = {
    chatId: chatIdStr,
    firstName: ctx.from?.first_name || null,
    lastName: ctx.from?.last_name || null,
    username: ctx.from?.username || null,
  };

  let user = await repo.findOne({ where: { chatId: chatIdStr } });
  if (!user) {
    user = repo.create({
      ...base,
      cityKey: null,
      ...updates,
    });
  } else {
    Object.assign(user, base);
    if (Object.prototype.hasOwnProperty.call(updates, "cityKey")) {
      user.cityKey = updates.cityKey;
    }
  }

  const saved = await repo.save(user);
  blockedChats.delete(chatIdStr);
  return saved;
}

function isPermanentTelegramDeliveryError(error) {
  const message = String(error?.description || error?.message || "").toLowerCase();
  const errorCode = Number(error?.error_code || error?.response?.error_code || 0);
  if (errorCode === 403) return true;
  return (
    message.includes("bot was blocked") ||
    message.includes("chat not found") ||
    message.includes("user is deactivated") ||
    message.includes("forbidden")
  );
}

async function sendHtmlMessage(botInstance, chatId, text) {
  try {
    await botInstance.api.sendMessage(chatId, text, { parse_mode: "HTML" });
    return true;
  } catch (error) {
    if (isPermanentTelegramDeliveryError(error)) {
      blockedChats.add(String(chatId));
    }
    console.warn("Message send failed:", chatId, error?.description || error?.message || error);
    return false;
  }
}

function shouldSendSaharlikReminder(now, row, userLastSaharlikDate, tomorrowIsoDate) {
  if (!row?.saharlikEnd) return false;
  if (normalizeDate(userLastSaharlikDate) === tomorrowIsoDate) return false;
  return (
    now.minutesOfDay >= SAHARLIK_NOTICE_WINDOW_START_MINUTES &&
    now.minutesOfDay <= SAHARLIK_NOTICE_WINDOW_END_MINUTES
  );
}

function shouldSendIftorReminder(now, row, userLastIftorDate) {
  if (normalizeDate(userLastIftorDate) === now.isoDate) return false;
  const iftorMinutes = parseTimeToMinutes(row?.iftor);
  if (!Number.isFinite(iftorMinutes)) return false;

  return (
    now.minutesOfDay >= IFTOR_NOTICE_WINDOW_START_MINUTES &&
    now.minutesOfDay <= IFTOR_NOTICE_WINDOW_END_MINUTES
  );
}

function startNotificationScheduler(botInstance) {
  let running = false;
  let timer = null;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      const repo = getUserRepo();
      const users = await repo.find();
      if (!users.length) return;

      const now = getNowInTashkent();
      const tomorrowIsoDate = getDateInTashkent(1).isoDate;

      const usersByCity = new Map();
      users.forEach((user) => {
        if (TEST_MODE && TEST_CHAT_ID && String(user.chatId) !== String(TEST_CHAT_ID)) return;
        const cityKey = user.cityKey || DEFAULT_CITY_KEY;
        if (!usersByCity.has(cityKey)) usersByCity.set(cityKey, []);
        usersByCity.get(cityKey).push(user);
      });

      const updates = [];

      for (const [cityKey, cityUsers] of usersByCity.entries()) {
        let payload;
        try {
          payload = await fetchCitySchedule(cityKey, { source: "notify" });
        } catch (error) {
          console.warn("Schedule fetch failed:", cityKey, error?.message || error);
          continue;
        }

        const city = payload.city || findCityByKey(cityKey);
        const row = payload.row;
        if (!row) continue;

        for (const user of cityUsers) {
          if (blockedChats.has(String(user.chatId))) continue;
          let touched = false;

          if (shouldSendSaharlikReminder(now, row, user.lastSaharlikNotifyDate, tomorrowIsoDate)) {
            const sent = await sendHtmlMessage(botInstance, user.chatId, formatSaharlikReminder(city, row));
            if (sent) {
              user.lastSaharlikNotifyDate = tomorrowIsoDate;
              touched = true;
            }
          }

          if (shouldSendIftorReminder(now, row, user.lastIftorNotifyDate)) {
            const sent = await sendHtmlMessage(botInstance, user.chatId, formatIftorReminder(city, row));
            if (sent) {
              user.lastIftorNotifyDate = now.isoDate;
              touched = true;
            }
          }

          if (touched) updates.push(user);
        }
      }

      if (updates.length) {
        await repo.save(updates);
      }
    } catch (error) {
      console.error("Notification scheduler error:", error);
    } finally {
      running = false;
    }
  };

  tick();
  timer = setInterval(tick, NOTIFY_CHECK_INTERVAL_MS);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

async function replyOrEdit(ctx, text, keyboard) {
  const opts = { parse_mode: "HTML" };
  if (keyboard) opts.reply_markup = keyboard;

  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (error) {
      console.warn("editMessageText failed, fallback to reply:", error?.description || error?.message);
    }
  }

  await ctx.reply(text, opts);
}

async function sendCityMenu(ctx, hint) {
  const intro =
    hint ||
    "Assalomu alaykum! Shaharni tanlang. Bot sizga har kuni 21:00-21:05 oralig'ida ertangi saharlik va 11:00-11:05 oralig'ida bugungi iftorlik vaqtini yuboradi.";
  await replyOrEdit(ctx, intro, buildCityKeyboard());
}

bot.command(["start", "help"], async (ctx) => {
  await upsertUserFromContext(ctx);
  await sendCityMenu(ctx);
});

bot.callbackQuery("cities", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Shahar ro'yxati" });
  await sendCityMenu(ctx, "Shaharni tanlang:");
});

bot.callbackQuery(/^city\|(.+)/, async (ctx) => {
  const cityKey = ctx.match[1];
  await ctx.answerCallbackQuery({ text: "Jadval yuklanmoqda..." });

  try {
    await upsertUserFromContext(ctx, { cityKey });
    const payload = await fetchCitySchedule(cityKey, { source: "display" });
    await replyOrEdit(ctx, formatDayMessage(payload.city, payload.row, "Bugungi jadval"), buildCityActions(cityKey));
  } catch (error) {
    await replyOrEdit(ctx, `Xatolik: ${escapeHtml(error.message || "jadvalni olishda xatolik")}`, buildCityKeyboard());
  }
});

bot.callbackQuery(/^(today|refresh)\|(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const cityKey = ctx.match[2];
  const force = action === "refresh";
  await ctx.answerCallbackQuery({ text: "Yangilanmoqda..." });

  try {
    await upsertUserFromContext(ctx, { cityKey });
    const payload = await fetchCitySchedule(cityKey, {
      force,
      source: "display",
    });
    await replyOrEdit(ctx, formatDayMessage(payload.city, payload.row, "Bugungi jadval"), buildCityActions(cityKey));
  } catch (error) {
    await replyOrEdit(ctx, `Xatolik: ${escapeHtml(error.message || "jadvalni olishda muammo")}`, buildCityActions(cityKey));
  }
});

bot.callbackQuery(/^(tomorrow|month)\|(.+)/, async (ctx) => {
  const cityKey = ctx.match[2];
  await ctx.answerCallbackQuery({ text: "Bu APIda faqat joriy jadval mavjud." });

  try {
    await upsertUserFromContext(ctx, { cityKey });
    const payload = await fetchCitySchedule(cityKey, { source: "display" });
    await replyOrEdit(ctx, formatDayMessage(payload.city, payload.row, "Bugungi jadval"), buildCityActions(cityKey));
  } catch (error) {
    await replyOrEdit(ctx, `Xatolik: ${escapeHtml(error.message || "jadvalni olishda muammo")}`, buildCityActions(cityKey));
  }
});

bot.on("message", async (ctx) => {
  await upsertUserFromContext(ctx);
  await ctx.reply(
    "Shaharni tanlash uchun menyudan foydalaning. Boshlash uchun /start ni yuboring.",
    { reply_markup: buildCityKeyboard() }
  );
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

async function bootstrap() {
  await initDb();
  const stopScheduler = startNotificationScheduler(bot);
  bot.start();
  console.log("Bot ishga tushdi.");

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} signal olindi. Bot to'xtatilmoqda...`);
    try {
      if (stopScheduler) stopScheduler();
      bot.stop();
    } catch (error) {
      console.error("Bot stop error:", error);
    }
    try {
      await closeDb();
    } catch (error) {
      console.error("DB close error:", error);
    }
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch((error) => {
  console.error("Bot ishga tushmadi:", error);
  process.exit(1);
});
