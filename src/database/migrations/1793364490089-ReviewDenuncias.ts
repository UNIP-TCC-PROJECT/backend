import { MigrationInterface, QueryRunner } from 'typeorm';

/** Campos para registrar a análise administrativa de denúncias existentes. */
export class ReviewDenuncias1793364490089 implements MigrationInterface {
  name = 'ReviewDenuncias1793364490089';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "denuncias" ADD "reviewNote" text`);
    await q.query(`ALTER TABLE "denuncias" ADD "reviewedBy" integer`);
    await q.query(`ALTER TABLE "denuncias" ADD "reviewedAt" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "denuncias" ADD CONSTRAINT "FK_denuncias_reviewed_by" FOREIGN KEY ("reviewedBy") REFERENCES "user"("id") ON DELETE SET NULL`);
    await q.query(`CREATE INDEX "IDX_denuncias_status_created" ON "denuncias" ("status", "createdAt")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_denuncias_status_created"`);
    await q.query(`ALTER TABLE "denuncias" DROP CONSTRAINT "FK_denuncias_reviewed_by"`);
    await q.query(`ALTER TABLE "denuncias" DROP COLUMN "reviewedAt"`);
    await q.query(`ALTER TABLE "denuncias" DROP COLUMN "reviewedBy"`);
    await q.query(`ALTER TABLE "denuncias" DROP COLUMN "reviewNote"`);
  }
}
