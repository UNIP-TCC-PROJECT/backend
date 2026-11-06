/**
 * Reexecuta as consultas externas (Receita, Mapa das OSCs, Portal da Transparência, Transferegov) de todas as
 * organizações e registra na auditoria. Útil depois de configurar uma chave de API nova.
 *
 * Uso (na pasta backend, com o .env exportado):
 *   set -a; . ./.env; set +a; npx ts-node -O '{"rootDir":"."}' --transpile-only scripts/reconsultar-fontes.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../src/database/entities';
import { dbOptions } from '../src/database/database.config';
import { AuditService } from '../src/audit/audit.service';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Organization } from '../src/organizations/entities/organization.entity';
import { OrganizationExternalCheck } from '../src/organizations/entities/organization-external-check.entity';
import { ExternalChecksService } from '../src/organizations/external-checks.service';

async function main() {
  const ds = await new DataSource({
    ...dbOptions('runtime'),
    entities: ENTITIES,
  }).initialize();
  const audit = new AuditService(ds.getRepository(AuditLog), ds);
  const checks = new ExternalChecksService(
    ds.getRepository(OrganizationExternalCheck),
  );
  const config = checks.configuration();
  console.log('Fontes configuradas:', JSON.stringify(config));

  for (const org of await ds
    .getRepository(Organization)
    .find({ order: { createdAt: 'ASC' } })) {
    const results = await checks.runAll(org, null);
    const resumo = Object.fromEntries(results.map((r) => [r.source, r.status]));
    await audit.log({
      actor: null,
      action: 'ORG_CHECKS_RERUN',
      entityType: 'organization',
      entityId: org.id,
      organizationId: org.id,
      metadata: { checks: resumo, origem: 'script reconsultar-fontes' },
    });
    console.log(`${org.tradeName ?? org.legalName}: ${JSON.stringify(resumo)}`);
  }
  const v = await audit.verify();
  console.log(
    `Cadeia de auditoria: ${v.ok ? 'íntegra' : 'QUEBRADA'} (${v.checked} registros)`,
  );
  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
