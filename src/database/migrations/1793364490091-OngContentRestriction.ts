import { MigrationInterface, QueryRunner } from 'typeorm';

export class OngContentRestriction1793364490091 implements MigrationInterface {
  name = 'OngContentRestriction1793364490091';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "user" ADD "contentRestricted" boolean NOT NULL DEFAULT false',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "user" DROP COLUMN "contentRestricted"');
  }
}
