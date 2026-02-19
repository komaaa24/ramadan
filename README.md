# Ramadan jadvali bot

GrammY (Node.js) asosidagi Telegram bot. `http://94.158.51.173:8080/ramazon/ramazon.php` API dan saharlik/iftorlik vaqtlarini olib ishlaydi.

## Ishga tushirish
- `npm install`
- `.env.example` ni `.env` ga ko'chiring va `BOT_TOKEN` ga bot tokenini yozing.
- `npm start`

## Production ishga tushirish
- `npm run start:prod`
- Tavsiya: `pm2` yoki `systemd` bilan processni doimiy ishga tushiring.
- `NODE_ENV=production` va `TYPEORM_SYNCHRONIZE=false` ishlating.
- `BOT_TOKEN` hech qachon gitga qo'shilmasin, oshkor bo'lsa darhol rotate qiling.

## Foydalanish
- `/start` — shahar tanlash menyusi.
- Tanlangan shahar uchun tugmalar: **Bugungi jadval**, **Yangilash**, **Shaharlar**.
- Avto-eslatma:
  - har kuni `21:00-21:05` oralig'ida: **Ertangi saharlik vaqti**
  - har kuni `10:00-10:05` oralig'ida: **Bugungi iftorlik vaqti**

## Texnik eslatmalar
- API URL: `RAMAZON_API_URL` (default: `http://94.158.51.173:8080/ramazon/ramazon.php`)
- Kesh: 5 daqiqa.
- API retry/backoff: `API_RETRY_COUNT`, `API_RETRY_DELAY_MS`, `API_TIMEOUT_MS`
