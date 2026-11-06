import 'dotenv/config';
import { DataSource } from 'typeorm';
import { dbOptions } from './database.config';

// CLI de migrations: sempre com o papel dono do schema (nunca o papel da aplicação).
export default new DataSource(dbOptions('migrator'));
