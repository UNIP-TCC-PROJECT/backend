import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mantém a situação operacional separada da análise de conteúdo.
 * Registros existentes permanecem aprovados; novos registros recebem sua análise
 * de acordo com o nível de verificação da ONG.
 */
export class ContentModeration1793364490088 implements MigrationInterface {
  name = 'ContentModeration1793364490088';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of ['publicacoes', 'campaigns', 'meta']) {
      await q.query(`ALTER TABLE "${table}" ADD "reviewStatus" character varying NOT NULL DEFAULT 'APROVADA'`);
      await q.query(`ALTER TABLE "${table}" ADD "reviewReason" text`);
      await q.query(`ALTER TABLE "${table}" ADD "reviewedBy" integer`);
      await q.query(`ALTER TABLE "${table}" ADD "reviewedAt" TIMESTAMP WITH TIME ZONE`);
      await q.query(`CREATE INDEX "IDX_${table}_review_status" ON "${table}" ("reviewStatus")`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['publicacoes', 'campaigns', 'meta']) {
      await q.query(`DROP INDEX "IDX_${table}_review_status"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN "reviewedAt"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN "reviewedBy"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN "reviewReason"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN "reviewStatus"`);
    }
  }
}
