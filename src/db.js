const { DataSource } = require("typeorm");
const { UserEntity } = require("./entities/User");

let dataSource = null;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function buildDataSourceOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  const base = {
    type: "postgres",
    entities: [UserEntity],
    synchronize: parseBoolean(process.env.TYPEORM_SYNCHRONIZE, !isProduction),
    logging: false,
  };

  if (process.env.DATABASE_URL) {
    return {
      ...base,
      url: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    ...base,
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    username: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: process.env.PGDATABASE || "ramadan",
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
  };
}

async function initDb() {
  if (dataSource?.isInitialized) return dataSource;
  dataSource = new DataSource(buildDataSourceOptions());
  await dataSource.initialize();
  return dataSource;
}

async function closeDb() {
  if (!dataSource?.isInitialized) return;
  await dataSource.destroy();
}

function getUserRepo() {
  if (!dataSource?.isInitialized) {
    throw new Error("Database is not initialized");
  }
  return dataSource.getRepository("User");
}

module.exports = {
  initDb,
  closeDb,
  getUserRepo,
};
