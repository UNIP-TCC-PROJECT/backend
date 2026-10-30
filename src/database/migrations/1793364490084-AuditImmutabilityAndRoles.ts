import { MigrationInterface, QueryRunner } from 'typeorm';

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/i;
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/**
 * 1) Imutabilidade da auditoria no banco: UPDATE/DELETE/TRUNCATE em audit_logs falham por gatilho.
 * 2) Permissões do papel de runtime (DB_USER): DML nas tabelas comuns; em audit_logs APENAS SELECT e INSERT;
 *    nenhum DDL, nenhum TRIGGER, nenhum TRUNCATE. O gatilho pertence ao papel dono (migrator), então a
 *    conexão da aplicação não consegue removê-lo nem desabilitá-lo (ALTER TABLE ... DISABLE TRIGGER exige ser dono).
 *
 * Limite honesto: quem for SUPERUSUÁRIO ou o DONO do schema (migrator) ainda pode alterar a trilha.
 * Por isso a senha do migrator não pode ser a da aplicação e a âncora externa do headHash continua recomendada.
 *
 * Reversão: down() remove gatilhos/função e revoga os privilégios concedidos.
 */
export class AuditImmutabilityAndRoles1793364490084 implements MigrationInterface {
  name = 'AuditImmutabilityAndRoles1793364490084';

  private runtimeRole(): string | null {
    const role = process.env.DB_USER;
    if (!role) return null;
    if (!IDENT.test(role)) throw new Error('DB_USER inválido para conceder permissões');
    return role;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_imutavel() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit_logs é imutável'; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_logs_row_guard ON "audit_logs"`);
    await queryRunner.query(`CREATE TRIGGER audit_logs_row_guard BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION audit_logs_imutavel()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_logs_truncate_guard ON "audit_logs"`);
    await queryRunner.query(`CREATE TRIGGER audit_logs_truncate_guard BEFORE TRUNCATE ON "audit_logs"
      FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_imutavel()`);

    const role = this.runtimeRole();
    const [{ s, me }] = await queryRunner.query(`SELECT current_schema() AS s, current_user AS me`);
    if (!role || role === me) {
      // Sem papel separado não há o que restringir: avisa em vez de fingir que protegeu.
      console.warn('[migration] DB_USER ausente ou igual ao dono do schema: permissões de runtime NÃO foram concedidas.');
      return;
    }
    const [S, R] = [q(s), q(role)];
    await queryRunner.query(`GRANT USAGE ON SCHEMA ${S} TO ${R}`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${S} TO ${R}`);
    await queryRunner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${S} TO ${R}`);
    await queryRunner.query(`REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ${S}."audit_logs" FROM ${R}`);
    // Tabelas criadas por migrations futuras herdam DML; uma migration que crie tabela imutável deve revogar explicitamente.
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${S} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${R}`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${S} GRANT USAGE, SELECT ON SEQUENCES TO ${R}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const role = this.runtimeRole();
    const [{ s, me }] = await queryRunner.query(`SELECT current_schema() AS s, current_user AS me`);
    if (role && role !== me) {
      const [S, R] = [q(s), q(role)];
      await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${S} REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${R}`);
      await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${S} REVOKE USAGE, SELECT ON SEQUENCES FROM ${R}`);
      await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${S} FROM ${R}`);
      await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${S} FROM ${R}`);
    }
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_logs_truncate_guard ON "audit_logs"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_logs_row_guard ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_imutavel()`);
  }
}
