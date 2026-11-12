import { MigrationInterface, QueryRunner } from 'typeorm';

/** Permite registrar denúncias de ONGs contra doadores. */
export class DonorReports1793364490092 implements MigrationInterface {
  name = 'DonorReports1793364490092';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "denuncias_tipoalvo_enum" ADD VALUE IF NOT EXISTS 'DOADOR'`,
    );
  }

  // O PostgreSQL não permite remover um valor enum com segurança se já houver registros usando-o.
  public async down(): Promise<void> {
    throw new Error('A remoção do tipo DOADOR exige uma migração manual de dados.');
  }
}
