import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Publicações da ONG ligadas à prestação de contas:
 *  - publicacoes ganha organizationId (preenchido pelo dono da organização), categoria e vínculos opcionais
 *    com campanha, despesa e entrega; imageUrl passa a ser opcional (publicação só de texto);
 *  - publicacao_anexos guarda imagens/documentos (bytea) com SHA-256, análise do admin e autorização de imagem.
 * Posts antigos permanecem como estão (imageUrl legado) e passam à categoria ATUALIZACAO.
 */
export class PublicacoesTransparencia1793364490085 implements MigrationInterface {
  name = 'PublicacoesTransparencia1793364490085';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "publicacoes" ALTER COLUMN "imageUrl" DROP NOT NULL`);
    await q.query(`ALTER TABLE "publicacoes" ADD "organizationId" uuid`);
    await q.query(`ALTER TABLE "publicacoes" ADD "category" character varying(30) NOT NULL DEFAULT 'ATUALIZACAO'`);
    await q.query(`ALTER TABLE "publicacoes" ADD "campaignId" uuid`);
    await q.query(`ALTER TABLE "publicacoes" ADD "expenseId" uuid`);
    await q.query(`ALTER TABLE "publicacoes" ADD "deliveryRecordId" uuid`);
    await q.query(`UPDATE "publicacoes" p SET "organizationId" = o."id" FROM "organizations" o WHERE o."ownerId" = p."ongId"`);
    await q.query(`ALTER TABLE "publicacoes" ADD CONSTRAINT "FK_publicacoes_organization" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT`);
    await q.query(`ALTER TABLE "publicacoes" ADD CONSTRAINT "FK_publicacoes_campaign" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT`);
    await q.query(`ALTER TABLE "publicacoes" ADD CONSTRAINT "FK_publicacoes_expense" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT`);
    await q.query(`ALTER TABLE "publicacoes" ADD CONSTRAINT "FK_publicacoes_delivery" FOREIGN KEY ("deliveryRecordId") REFERENCES "delivery_records"("id") ON DELETE RESTRICT`);
    await q.query(`CREATE INDEX "IDX_publicacoes_org_created" ON "publicacoes" ("organizationId", "createdAt")`);
    await q.query(`CREATE INDEX "IDX_publicacoes_expense" ON "publicacoes" ("expenseId")`);
    await q.query(`CREATE INDEX "IDX_publicacoes_delivery" ON "publicacoes" ("deliveryRecordId")`);

    await q.query(`CREATE TABLE "publicacao_anexos" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "publicacaoId" integer NOT NULL,
      "organizationId" uuid,
      "kind" character varying NOT NULL,
      "imageConsent" boolean NOT NULL DEFAULT false,
      "publishable" boolean NOT NULL DEFAULT false,
      "name" character varying NOT NULL,
      "mime" character varying NOT NULL,
      "size" integer NOT NULL,
      "sha256" character varying(64) NOT NULL,
      "content" bytea NOT NULL,
      "status" character varying NOT NULL DEFAULT 'PENDENTE',
      "uploadedBy" integer NOT NULL,
      "reviewedBy" integer,
      "reviewedAt" TIMESTAMP WITH TIME ZONE,
      "reviewReason" text,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_publicacao_anexos" PRIMARY KEY ("id"),
      CONSTRAINT "FK_publicacao_anexos_pub" FOREIGN KEY ("publicacaoId") REFERENCES "publicacoes"("id") ON DELETE CASCADE)`);
    await q.query(`CREATE INDEX "IDX_publicacao_anexos_pub" ON "publicacao_anexos" ("publicacaoId")`);
    await q.query(`CREATE INDEX "IDX_publicacao_anexos_status" ON "publicacao_anexos" ("status")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "publicacao_anexos"`);
    for (const i of ['IDX_publicacoes_delivery', 'IDX_publicacoes_expense', 'IDX_publicacoes_org_created']) await q.query(`DROP INDEX "${i}"`);
    for (const c of ['FK_publicacoes_delivery', 'FK_publicacoes_expense', 'FK_publicacoes_campaign', 'FK_publicacoes_organization']) await q.query(`ALTER TABLE "publicacoes" DROP CONSTRAINT "${c}"`);
    for (const col of ['deliveryRecordId', 'expenseId', 'campaignId', 'category', 'organizationId']) await q.query(`ALTER TABLE "publicacoes" DROP COLUMN "${col}"`);
    // Só volta a NOT NULL se nenhum post for apenas de texto (senão a reversão perderia dados).
    await q.query(`UPDATE "publicacoes" SET "imageUrl" = '' WHERE "imageUrl" IS NULL`);
    await q.query(`ALTER TABLE "publicacoes" ALTER COLUMN "imageUrl" SET NOT NULL`);
  }
}
