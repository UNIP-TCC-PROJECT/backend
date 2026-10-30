require('dotenv/config');
const { Client } = require('pg');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};
if (!config.user || !config.password || !config.database) {
  console.error('Defina DB_USER, DB_PASSWORD e DB_NAME (sem valores padrão).');
  process.exit(1);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDb() {
  // Keep retrying until Postgres is reachable on localhost.
  console.info('Waiting for database...');
  while (true) {
    const client = new Client(config);
    try {
      await client.connect();
      await client.end();
      console.log('Database is ready!');
      return;
    } catch (error) {
      try {
        await client.end();
      } catch (_) {
        // Ignore close errors from failed connections.
      }
      await delay(1000);
    }
  }
}

waitForDb().catch((error) => {
  console.error('Database wait failed:', error);
  process.exit(1);
});
