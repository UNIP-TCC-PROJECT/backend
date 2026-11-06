import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Subcontas de pagamento por ONG. Só cria uma tabela nova: não toca em dados existentes.
 * Reversível: down() remove a tabela (só faça isso antes de haver subcontas reais, pois a chave de API
 * da subconta não pode ser recuperada no provedor).
 */
export class OrganizationPaymentAccounts1793364490087 implements MigrationInterface {
  name = 'OrganizationPaymentAccounts1793364490087';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "organization_payment_accounts" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "organizationId" uuid NOT NULL,
      "provider" character varying NOT NULL DEFAULT 'ASAAS',
      "environment" character varying(12) NOT NULL,
      "providerAccountId" character varying,
      "walletId" character varying,
      "apiKeyEnc" text,
      "status" character varying NOT NULL DEFAULT 'CRIANDO',
      "providerStatus" jsonb,
      "statusDetail" text,
      "createdBy" integer,
      "approvedAt" TIMESTAMP WITH TIME ZONE,
      "lastCheckedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_organization_payment_accounts" PRIMARY KEY ("id"),
      CONSTRAINT "FK_org_payment_accounts_organization" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT
    )`);
    await q.query(`CREATE UNIQUE INDEX "IDX_org_payment_accounts_org" ON "organization_payment_accounts" ("organizationId")`);
    await q.query(`CREATE UNIQUE INDEX "IDX_org_payment_accounts_provider_account" ON "organization_payment_accounts" ("providerAccountId")`);
    await q.query(`CREATE UNIQUE INDEX "IDX_org_payment_accounts_wallet" ON "organization_payment_accounts" ("walletId")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "organization_payment_accounts"`);
  }
}
