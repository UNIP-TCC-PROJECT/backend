import { DataSource } from 'typeorm';
import { User, UserType } from './src/users/entities/user.entity';
import * as bcrypt from 'bcrypt';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'tcc_db',
  entities: [User],
  synchronize: true,
});

async function seed() {
  await AppDataSource.initialize();

  const repo = AppDataSource.getRepository(User);

  const ongs = [
    {
      name: 'ONG Esperança',
      email: 'contato@ongesperanca.org',
      password: await bcrypt.hash('senha123', 10),
      type: UserType.ONG,
      cnpj: '12.345.678/0001-99',
      description: 'ONG dedicada a ajudar crianças.',
    },
    {
      name: 'ONG Vida Nova',
      email: 'contato@vidanova.org',
      password: await bcrypt.hash('senha456', 10),
      type: UserType.ONG,
      cnpj: '98.765.432/0001-11',
      description: 'Apoio a famílias em situação de vulnerabilidade.',
    },
  ];

  for (const ong of ongs) {
    const exists = await repo.findOne({ where: { email: ong.email } });
    if (!exists) {
      await repo.save(repo.create(ong));
      console.log(`ONG ${ong.name} cadastrada.`);
    } else {
      console.log(`ONG ${ong.name} já existe.`);
    }
  }

  await AppDataSource.destroy();
  console.log('Seed finalizado.');
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
