const { Client } = require('pg');

const config = {
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'tcc_db',
};

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
