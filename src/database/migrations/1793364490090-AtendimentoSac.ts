import { MigrationInterface, QueryRunner } from 'typeorm';

/** Atendimento separado das conversas privadas entre doadores e ONGs. */
export class AtendimentoSac1793364490090 implements MigrationInterface {
  name = 'AtendimentoSac1793364490090';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "sac_conversas" (
      "id" SERIAL PRIMARY KEY,
      "usuarioId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "ultimaMensagemEm" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_sac_conversas_usuario" ON "sac_conversas" ("usuarioId")`,
    );
    await q.query(`CREATE TABLE "sac_mensagens" (
      "id" SERIAL PRIMARY KEY,
      "conversaId" integer NOT NULL REFERENCES "sac_conversas"("id") ON DELETE CASCADE,
      "remetenteId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "texto" text NOT NULL CHECK (char_length(btrim("texto")) BETWEEN 1 AND 2000),
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )`);
    await q.query(
      `CREATE INDEX "IDX_sac_mensagens_conversa_data" ON "sac_mensagens" ("conversaId", "createdAt")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "sac_mensagens"`);
    await q.query(`DROP TABLE "sac_conversas"`);
  }
}
