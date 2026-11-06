import { MigrationInterface, QueryRunner } from 'typeorm';

/** Imagem de capa do perfil público da ONG. Reversível: down() remove a coluna. */
export class UserCoverImage1793364490086 implements MigrationInterface {
  name = 'UserCoverImage1793364490086';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "user" ADD "coverImage" character varying(500)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "user" DROP COLUMN "coverImage"`);
  }
}
