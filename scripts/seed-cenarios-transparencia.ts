/**
 * Cenários de TESTE para validar níveis de transparência e o perfil público (somente desenvolvimento).
 *
 * Uso (na pasta backend, com o .env exportado):
 *   set -a; . ./.env; set +a; npx ts-node scripts/seed-cenarios-transparencia.ts
 *
 * Grava pelo papel de runtime e registra tudo na trilha de auditoria (cadeia de hash preservada), com
 * metadata { seed: 'cenarios-transparencia' }. É reexecutável: pula o que já foi criado.
 * Os CNPJs são reais (ver IDENT) e as consultas externas rodam de verdade contra as APIs públicas;
 * o que o script inventa é só o movimento financeiro, as publicações e os arquivos de teste.
 *
 *  ONG 5  Fundação Abrinq    → aprovada, tudo comprovado e entregas verificadas (nível exemplar)
 *  ONG 8  Bem Para Todos     → aprovada, com pendências financeiras e entrega sem evidência (em desenvolvimento)
 *  ONG 2  AACD Ibirapuera    → pendente de aprovação, cadastro completo
 *  ONG 3  Instituto Vida Nova → pendente, com sinais de futura reprovação
 */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../src/database/entities';
import { dbOptions } from '../src/database/database.config';
import { AuditService } from '../src/audit/audit.service';
import { AuditLog } from '../src/audit/audit-log.entity';
import { User, UserType } from '../src/users/entities/user.entity';
import {
  Organization,
  OrganizationStatus,
} from '../src/organizations/entities/organization.entity';
import {
  OrganizationDocument,
  OrganizationDocumentType,
} from '../src/organizations/entities/organization-document.entity';
import { OrganizationValidation } from '../src/organizations/entities/organization-validation.entity';
import {
  CheckSource,
  CheckStatus,
  OrganizationExternalCheck,
} from '../src/organizations/entities/organization-external-check.entity';
import { ExternalChecksService } from '../src/organizations/external-checks.service';
import {
  Campaign,
  CampaignStatus,
} from '../src/campaigns/entities/campaign.entity';
import {
  Donation,
  DonationStatus,
} from '../src/donations/entities/donation.entity';
import {
  Expense,
  ExpenseDocument,
  ExpenseDocumentKind,
} from '../src/accountability/entities/expense.entity';
import {
  DeliveryEvidence,
  DeliveryRecord,
  EvidenceKind,
} from '../src/accountability/entities/delivery.entity';
import { AccStatus } from '../src/common/accountability-status';
import { ReviewStatus } from '../src/common/stored-file.base';
import { Publicacao } from '../src/publicacoes/entities/publicacao.entity';
import { PublicacaoAnexo } from '../src/publicacoes/entities/publicacao-anexo.entity';

const ADMIN_ID = 7;
const DONORS = [1, 4];
const TAG = { seed: 'cenarios-transparencia' };

// CNPJs REAIS (ativos na Receita, conferidos na BrasilAPI). Razão social, nome fantasia e endereço seguem o cadastro
// público para que as consultas externas reais não apontem divergência. Só a ONG 3 diverge de propósito.
// Os dados financeiros, publicações e documentos gerados pelo script são fictícios e existem só neste banco de teste.
const IDENT = {
  5: {
    cnpj: '38894796000146',
    legalName: 'Fundação Abrinq pelos Direitos da Criança e do Adolescente',
    tradeName: 'Fundação Abrinq',
    description:
      'Fundação que promove os direitos de crianças e adolescentes por meio de educação, proteção e distribuição de alimentos e material escolar, com prestação de contas pública de cada ação.',
    address: {
      zip: '04514041',
      street: 'Rua Araguari',
      number: '835',
      district: 'Vila Uberabinha',
    },
  },
  2: {
    cnpj: '60979457000111',
    legalName: 'Associação de Assistência à Criança Deficiente',
    tradeName: 'AACD Ibirapuera',
    description:
      'Associação que oferece reabilitação e atendimento a crianças e jovens com deficiência física, com apoio de equipe multiprofissional e atividades de inclusão.',
    address: {
      zip: '04027000',
      street: 'Rua Professor Ascendino Reis',
      number: '724',
      district: 'Vila Clementino',
    },
  },
  3: {
    cnpj: '67185694000150', // existe, mas pertence a outra instituição: razão social, CEP e município divergem
    legalName: 'Vida Nova Serviços e Comércio Ltda',
    tradeName: 'Instituto Vida Nova',
    description: 'Apoio a famílias em situação de vulnerabilidade.',
    address: {
      zip: '01310100',
      street: 'Avenida Paulista',
      number: '1000',
      district: 'Bela Vista',
    },
  },
} as const;
const maskCnpj = (c: string) =>
  c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const DAY = 86_400_000;
const ago = (d: number, hours = 0) =>
  new Date(Date.now() - d * DAY - hours * 3_600_000);
const isoDay = (d: number) => ago(d).toISOString().slice(0, 10);

// ---------- Arquivos de teste válidos (PNG e PDF gerados aqui, sem dependências) ----------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
function png(
  w: number,
  h: number,
  shade: (x: number, y: number) => [number, number, number],
) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = shade(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PALETTES: [number, number, number][][] = [
  [
    [255, 210, 87],
    [155, 132, 88],
  ],
  [
    [244, 235, 221],
    [226, 182, 79],
  ],
  [
    [120, 170, 130],
    [244, 235, 221],
  ],
  [
    [110, 150, 190],
    [244, 235, 221],
  ],
  [
    [200, 120, 90],
    [255, 210, 87],
  ],
  [
    [90, 120, 100],
    [226, 182, 79],
  ],
];
/** Imagem de teste: degradê + círculos, com cores variadas por semente. */
function picture(seed: number, w = 960, h = 600) {
  const [a, b] = PALETTES[seed % PALETTES.length];
  const cx = [w * 0.3, w * 0.7, w * 0.5],
    cy = [h * 0.4, h * 0.6, h * 0.25],
    rad = [h * 0.22, h * 0.17, h * 0.1];
  return png(w, h, (x, y) => {
    const t = (x / w + y / h) / 2;
    let c: [number, number, number] = [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
    for (let i = 0; i < 3; i++) {
      if ((x - cx[(i + seed) % 3]) ** 2 + (y - cy[i]) ** 2 < rad[i] ** 2)
        c = [
          c[0] * 0.6 + 255 * 0.4,
          c[1] * 0.6 + 255 * 0.4,
          c[2] * 0.6 + 255 * 0.4,
        ];
    }
    return [c[0] | 0, c[1] | 0, c[2] | 0];
  });
}
/** PDF mínimo e válido com algumas linhas de texto. */
function pdf(lines: string[]) {
  const esc = (s: string) =>
    s
      .replace(/[()\\]/g, '\\$&')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const text = `BT /F1 14 Tf 60 760 Td 18 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const off: number[] = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const stored = (buf: Buffer, name: string, mime: string) => ({
  name,
  mime,
  size: buf.length,
  sha256: sha(buf),
  content: buf,
});

async function main() {
  const ds = await new DataSource({
    ...dbOptions('runtime'),
    entities: ENTITIES,
  }).initialize();
  const audit = new AuditService(ds.getRepository(AuditLog), ds);
  const checks = new ExternalChecksService(
    ds.getRepository(OrganizationExternalCheck),
  );
  const admin = { id: ADMIN_ID, type: UserType.ADMIN };
  const log = (
    actor: { id: number; type: string } | null,
    action: string,
    entityType: string,
    entityId: string | number,
    organizationId: string,
    metadata: object = {},
  ) =>
    audit.log({
      actor,
      action,
      entityType,
      entityId,
      organizationId,
      metadata: { ...TAG, ...metadata },
    });
  const uploads = join(process.cwd(), 'uploads');
  for (const d of ['avatars', 'covers', 'campaigns'])
    await mkdir(join(uploads, d), { recursive: true });

  const orgOf = (u: User, over: Partial<Organization>) =>
    ds.getRepository(Organization).create({
      ownerId: u.id,
      tradeName: u.name,
      description: u.description ?? null,
      email: u.email,
      phone: '11988887777',
      zip: '01310100',
      street: 'Avenida Paulista',
      number: '1000',
      complement: null,
      district: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      legalRepName: 'Responsável de Teste',
      legalRepCpf: '52998224725',
      legalRepRole: 'Presidente',
      legalRepEmail: u.email,
      legalRepPhone: '11988887777',
      ...over,
    });
  async function images(u: User, n: number, desc: string) {
    const av = `/uploads/avatars/seed-ong${u.id}.png`,
      cv = `/uploads/covers/seed-ong${u.id}.png`;
    await writeFile(
      join(uploads, 'avatars', `seed-ong${u.id}.png`),
      picture(n, 320, 320),
    );
    await writeFile(
      join(uploads, 'covers', `seed-ong${u.id}.png`),
      picture(n + 1, 1400, 420),
    );
    await ds.getRepository(User).update(u.id, {
      profileImage: av,
      coverImage: cv,
      description: u.description || desc,
    });
  }
  async function docs(
    org: Organization,
    u: User,
    spec: {
      type: OrganizationDocumentType;
      status: ReviewStatus;
      reason?: string;
      ageDays: number;
    }[],
  ) {
    for (const s of spec) {
      const buf = pdf([
        `DOCUMENTO DE TESTE - ${s.type}`,
        `Instituicao: ${org.legalName}`,
        `CNPJ: ${org.cnpj}`,
        'Arquivo gerado para validar o fluxo de analise.',
      ]);
      const row = await ds.getRepository(OrganizationDocument).save(
        ds.getRepository(OrganizationDocument).create({
          ...stored(buf, `${s.type.toLowerCase()}.pdf`, 'application/pdf'),
          organizationId: org.id,
          type: s.type,
          uploadedBy: u.id,
          status: s.status,
          supersededAt: null,
          reviewedBy: s.status === ReviewStatus.PENDENTE ? null : ADMIN_ID,
          reviewedAt:
            s.status === ReviewStatus.PENDENTE ? null : ago(s.ageDays - 1),
          reviewReason: s.reason ?? null,
        }),
      );
      await ds.query(
        `UPDATE organization_documents SET "createdAt" = $1 WHERE id = $2`,
        [ago(s.ageDays), row.id],
      );
      if (s.status !== ReviewStatus.PENDENTE)
        await log(
          admin,
          'ORG_DOCUMENT_REVIEWED',
          'organization_document',
          row.id,
          org.id,
          { type: s.type, status: s.status, reason: s.reason ?? null },
        );
    }
  }
  const allDocs = (st: ReviewStatus, age: number) =>
    [
      OrganizationDocumentType.ESTATUTO,
      OrganizationDocumentType.ATA_DIRETORIA,
      OrganizationDocumentType.COMPROVANTE_ENDERECO,
      OrganizationDocumentType.DOC_REPRESENTANTE,
    ].map((type) => ({ type, status: st, ageDays: age }));
  async function approve(
    org: Organization,
    u: User,
    ageCreated: number,
    ageApproved: number,
    meta: object = {},
  ) {
    await ds.query(`UPDATE organizations SET "createdAt" = $1 WHERE id = $2`, [
      ago(ageCreated),
      org.id,
    ]);
    await ds.getRepository(Organization).update(org.id, {
      status: OrganizationStatus.APROVADA,
      statusReason: null,
      reviewedBy: ADMIN_ID,
      reviewedAt: ago(ageApproved),
    });
    await ds.getRepository(OrganizationValidation).save(
      ds.getRepository(OrganizationValidation).create({
        organizationId: org.id,
        decision: 'APROVAR',
        reason: 'Cenário de teste',
        reviewedBy: ADMIN_ID,
      }),
    );
    await log(admin, 'ORG_APPROVED', 'organization', org.id, org.id, {
      reason: 'Cenário de teste',
      ...meta,
    });
  }
  async function submit(
    org: Organization,
    u: User,
    checksSummary: object = {},
  ) {
    await log(
      { id: u.id, type: UserType.ONG },
      'ORG_CREATED',
      'organization',
      org.id,
      org.id,
    );
    await log(
      { id: u.id, type: UserType.ONG },
      'ORG_SUBMITTED',
      'organization',
      org.id,
      org.id,
      { checks: checksSummary },
    );
  }

  // ---------- Publicações ----------
  async function post(
    org: Organization,
    u: User,
    p: {
      text: string;
      category: string;
      ageDays: number;
      campaignId?: string;
      expenseId?: string;
      deliveryRecordId?: string;
    },
    files: {
      kind: 'IMAGEM' | 'DOCUMENTO';
      n: number;
      status: AccStatus;
      publishable: boolean;
      reason?: string;
      name?: string;
    }[] = [],
  ) {
    const pub = await ds.getRepository(Publicacao).save(
      ds.getRepository(Publicacao).create({
        ongId: u.id,
        organizationId: org.id,
        description: p.text,
        category: p.category,
        imageUrl: null,
        campaignId: p.campaignId ?? null,
        expenseId: p.expenseId ?? null,
        deliveryRecordId: p.deliveryRecordId ?? null,
      }),
    );
    await ds.query(`UPDATE publicacoes SET "createdAt" = $1 WHERE id = $2`, [
      ago(p.ageDays),
      pub.id,
    ]);
    await log(
      { id: u.id, type: UserType.ONG },
      'PUBLICATION_CREATED',
      'publicacao',
      pub.id,
      org.id,
      { category: p.category },
    );
    for (const f of files) {
      const buf =
        f.kind === 'IMAGEM'
          ? picture(f.n)
          : pdf([
              `RELATORIO DE TESTE ${f.n}`,
              org.legalName,
              'Documento gerado para validar o fluxo de publicacoes.',
            ]);
      const a = await ds.getRepository(PublicacaoAnexo).save(
        ds.getRepository(PublicacaoAnexo).create({
          ...stored(
            buf,
            f.name ??
              (f.kind === 'IMAGEM'
                ? `foto-${f.n}.png`
                : `relatorio-${f.n}.pdf`),
            f.kind === 'IMAGEM' ? 'image/png' : 'application/pdf',
          ),
          publicacaoId: pub.id,
          organizationId: org.id,
          kind: f.kind,
          imageConsent: f.kind === 'IMAGEM',
          publishable: f.publishable,
          status: f.status,
          uploadedBy: u.id,
          reviewedBy: f.status === AccStatus.ENVIADA ? null : ADMIN_ID,
          reviewedAt:
            f.status === AccStatus.ENVIADA
              ? null
              : ago(Math.max(0, p.ageDays - 1)),
          reviewReason: f.reason ?? null,
        }),
      );
      await log(
        { id: u.id, type: UserType.ONG },
        'PUBLICATION_ATTACHMENT_ADDED',
        'publicacao_anexo',
        a.id,
        org.id,
        { publicacaoId: pub.id, kind: f.kind, sha256: a.sha256 },
      );
      if (f.status !== AccStatus.ENVIADA)
        await log(
          admin,
          'PUBLICATION_ATTACHMENT_REVIEWED',
          'publicacao_anexo',
          a.id,
          org.id,
          { status: f.status, publishable: f.publishable },
        );
    }
    return pub;
  }

  // ---------- Prestação de contas ----------
  async function campaign(
    org: Organization,
    u: User,
    c: {
      title: string;
      description: string;
      objective: string;
      goal: number;
      status: CampaignStatus;
      startDays: number;
      endDays: number;
      n: number;
    },
  ) {
    const file = `seed-${org.id.slice(0, 8)}-${c.n}.png`;
    await writeFile(join(uploads, 'campaigns', file), picture(c.n, 1000, 560));
    const row = await ds.getRepository(Campaign).save(
      ds.getRepository(Campaign).create({
        organizationId: org.id,
        title: c.title,
        description: c.description,
        objective: c.objective,
        goalCents: c.goal,
        imageUrl: `/uploads/campaigns/${file}`,
        startsAt: ago(c.startDays),
        endsAt: new Date(Date.now() + c.endDays * DAY),
        status: c.status,
        statusReason: null,
      }),
    );
    await ds.query(`UPDATE campaigns SET "createdAt" = $1 WHERE id = $2`, [
      ago(c.startDays + 1),
      row.id,
    ]);
    if (c.status !== CampaignStatus.RASCUNHO)
      await log(
        { id: u.id, type: UserType.ONG },
        'CAMPAIGN_PUBLISHED',
        'campaign',
        row.id,
        org.id,
        { title: c.title },
      );
    return row;
  }
  let donationSeq = 0;
  async function donation(
    camp: Campaign,
    status: DonationStatus,
    cents: number,
    ageDays: number,
  ) {
    const donorId = DONORS[donationSeq % DONORS.length];
    const d = ds.getRepository(Donation).create({
      campaignId: camp.id,
      donorId,
      amountCents: cents,
      status,
      provider: 'ASAAS',
      providerPaymentId: null,
      idempotencyKey: `seed-cenarios-${camp.id.slice(0, 8)}-${++donationSeq}`,
      confirmedAt:
        status === DonationStatus.CONFIRMADA ||
        status === DonationStatus.ESTORNADA
          ? ago(ageDays)
          : null,
      refundedAt: status === DonationStatus.ESTORNADA ? ago(ageDays - 2) : null,
      pixPayload: status === DonationStatus.PENDENTE ? 'SEED-PIX-TESTE' : null,
      failureReason:
        status === DonationStatus.CANCELADA
          ? 'Cenário de teste: cobrança expirada'
          : null,
    });
    const row = await ds.getRepository(Donation).save(d);
    await ds.query(`UPDATE donations SET "createdAt" = $1 WHERE id = $2`, [
      ago(ageDays, 1),
      row.id,
    ]);
  }
  async function expense(
    org: Organization,
    u: User,
    e: {
      camp: Campaign;
      description: string;
      category: string;
      cents: number;
      ageDays: number;
      supplier: string;
      supplierDocument: string;
      status: AccStatus;
      reason?: string;
      docs: {
        kind: ExpenseDocumentKind;
        status: AccStatus;
        publishable: boolean;
      }[];
    },
  ) {
    const row = await ds.getRepository(Expense).save(
      ds.getRepository(Expense).create({
        organizationId: org.id,
        campaignId: e.camp.id,
        description: e.description,
        category: e.category,
        supplier: e.supplier,
        supplierDocument: e.supplierDocument,
        amountCents: e.cents,
        spentAt: isoDay(e.ageDays),
        status: e.status,
        reviewedBy: [AccStatus.ENVIADA, AccStatus.EM_ANALISE].includes(e.status)
          ? null
          : ADMIN_ID,
        reviewedAt: [AccStatus.ENVIADA, AccStatus.EM_ANALISE].includes(e.status)
          ? null
          : ago(e.ageDays - 2),
        reviewReason: e.reason ?? null,
      }),
    );
    await ds.query(`UPDATE expenses SET "createdAt" = $1 WHERE id = $2`, [
      ago(e.ageDays - 1),
      row.id,
    ]);
    await log(
      { id: u.id, type: UserType.ONG },
      'EXPENSE_CREATED',
      'expense',
      row.id,
      org.id,
      { amountCents: e.cents, campaignId: e.camp.id },
    );
    for (const [i, d] of e.docs.entries()) {
      const buf = pdf([
        `${d.kind} - DOCUMENTO DE TESTE`,
        e.description,
        `Valor: R$ ${(e.cents / 100).toFixed(2)}`,
        `Fornecedor: ${e.supplier}`,
      ]);
      const doc = await ds.getRepository(ExpenseDocument).save(
        ds.getRepository(ExpenseDocument).create({
          ...stored(
            buf,
            `${d.kind.toLowerCase()}-${i + 1}.pdf`,
            'application/pdf',
          ),
          organizationId: org.id,
          expenseId: row.id,
          kind: d.kind,
          publishable: d.publishable,
          status: d.status,
          uploadedBy: u.id,
          reviewedBy: d.status === AccStatus.ENVIADA ? null : ADMIN_ID,
          reviewedAt:
            d.status === AccStatus.ENVIADA ? null : ago(e.ageDays - 2),
          reviewReason: null,
        }),
      );
      await log(
        { id: u.id, type: UserType.ONG },
        'EXPENSE_DOCUMENT_UPLOADED',
        'expense_document',
        doc.id,
        org.id,
        { expenseId: row.id, kind: d.kind, sha256: doc.sha256 },
      );
    }
    if (e.status === AccStatus.APROVADA)
      await log(admin, 'EXPENSE_APPROVED', 'expense', row.id, org.id, {
        amountCents: e.cents,
      });
    return row;
  }
  async function delivery(
    org: Organization,
    u: User,
    d: {
      camp: Campaign;
      expense?: Expense;
      item: string;
      bought: number;
      given: number;
      unit: string;
      text: string;
      ageDays: number;
      region: string;
    },
  ) {
    const row = await ds.getRepository(DeliveryRecord).save(
      ds.getRepository(DeliveryRecord).create({
        organizationId: org.id,
        campaignId: d.camp.id,
        expenseId: d.expense?.id ?? null,
        itemDescription: d.item,
        quantityPurchased: d.bought,
        quantityDistributed: d.given,
        unit: d.unit,
        description: d.text,
        deliveredAt: isoDay(d.ageDays),
        region: d.region,
        locationDetail: 'Ponto de distribuição (detalhe interno)',
        responsibleName: 'Equipe da instituição',
        registeredBy: u.id,
      }),
    );
    await ds.query(
      `UPDATE delivery_records SET "createdAt" = $1 WHERE id = $2`,
      [ago(d.ageDays), row.id],
    );
    await log(
      { id: u.id, type: UserType.ONG },
      'DELIVERY_RECORDED',
      'delivery_record',
      row.id,
      org.id,
      { campaignId: d.camp.id },
    );
    return row;
  }
  async function evidence(
    org: Organization,
    u: User,
    e: {
      delivery?: DeliveryRecord;
      camp?: Campaign;
      kind: EvidenceKind;
      text: string;
      ageDays: number;
      status: AccStatus;
      publishable: boolean;
      n: number;
      asPdf?: boolean;
    },
  ) {
    const buf = e.asPdf
      ? pdf(['RELATORIO DE ATIVIDADE - TESTE', e.text, org.legalName])
      : picture(e.n);
    const row = await ds.getRepository(DeliveryEvidence).save(
      ds.getRepository(DeliveryEvidence).create({
        ...stored(
          buf,
          e.asPdf ? `relatorio-${e.n}.pdf` : `foto-${e.n}.png`,
          e.asPdf ? 'application/pdf' : 'image/png',
        ),
        organizationId: org.id,
        deliveryRecordId: e.delivery?.id ?? null,
        campaignId: e.camp?.id ?? e.delivery?.campaignId ?? null,
        kind: e.kind,
        description: e.text,
        takenAt: isoDay(e.ageDays),
        responsibleName: 'Equipe da instituição',
        publishable: e.publishable,
        status: e.status,
        uploadedBy: u.id,
        reviewedBy: e.status === AccStatus.ENVIADA ? null : ADMIN_ID,
        reviewedAt: e.status === AccStatus.ENVIADA ? null : ago(e.ageDays - 1),
        reviewReason: null,
      }),
    );
    if (e.status !== AccStatus.ENVIADA)
      await log(
        admin,
        'EVIDENCE_REVIEWED',
        'delivery_evidence',
        row.id,
        org.id,
        { status: e.status, publishable: e.publishable },
      );
    return row;
  }

  const users = await ds
    .getRepository(User)
    .find({ where: { type: UserType.ONG } });
  const U = (id: number) => {
    const u = users.find((x) => x.id === id);
    if (!u) throw new Error(`ONG ${id} não encontrada`);
    const i = IDENT[id as keyof typeof IDENT];
    if (i)
      Object.assign(u, {
        name: i.tradeName,
        cnpj: maskCnpj(i.cnpj),
        description: i.description,
      });
    return u;
  };
  for (const [id, i] of Object.entries(IDENT))
    await ds.getRepository(User).update(Number(id), {
      name: i.tradeName,
      cnpj: maskCnpj(i.cnpj),
      description: i.description,
    });
  const orgRepo = ds.getRepository(Organization);
  const has = async (ownerId: number) => orgRepo.findOneBy({ ownerId });

  // ======================= ONG 5 — Fundação Abrinq: tudo comprovado =======================
  {
    const u = U(5);
    if ((await has(5))?.status === OrganizationStatus.APROVADA)
      console.log('ONG 5: já criada, pulando');
    else {
      console.log('ONG 5: criando cenário "exemplar"…');
      await images(u, 2, IDENT[5].description);
      const org = await orgRepo.save(
        orgOf(u, {
          cnpj: IDENT[5].cnpj,
          legalName: IDENT[5].legalName,
          tradeName: IDENT[5].tradeName,
          description: IDENT[5].description,
          ...IDENT[5].address,
          status: OrganizationStatus.EM_ANALISE,
        }),
      );
      const results = await checks.runAll(org, null); // consultas REAIS
      await submit(
        org,
        u,
        Object.fromEntries(results.map((r) => [r.source, r.status])),
      );
      await docs(org, u, [
        ...allDocs(ReviewStatus.APROVADO, 88),
        {
          type: OrganizationDocumentType.CARTAO_CNPJ,
          status: ReviewStatus.APROVADO,
          ageDays: 87,
        },
      ]);
      await approve(org, u, 90, 85);

      const c1 = await campaign(org, u, {
        title: 'Cestas básicas para o inverno',
        description:
          'Arrecadação para montar e distribuir cestas básicas a famílias cadastradas durante o inverno.',
        objective: 'Distribuir 120 cestas básicas',
        goal: 800000,
        status: CampaignStatus.ATIVA,
        startDays: 70,
        endDays: 45,
        n: 0,
      });
      const c2 = await campaign(org, u, {
        title: 'Material escolar 2026',
        description:
          'Kits de material escolar para crianças atendidas pelo projeto de reforço.',
        objective: 'Entregar 80 kits',
        goal: 500000,
        status: CampaignStatus.ATIVA,
        startDays: 60,
        endDays: 60,
        n: 1,
      });
      const c3 = await campaign(org, u, {
        title: 'Reforma da cozinha comunitária',
        description:
          'Reforma da cozinha onde são preparadas as refeições do projeto.',
        objective: 'Concluir a reforma',
        goal: 300000,
        status: CampaignStatus.ENCERRADA,
        startDays: 85,
        endDays: -10,
        n: 2,
      });
      for (const [camp, cents, age] of [
        [c1, 20000, 66],
        [c1, 5000, 60],
        [c1, 15000, 52],
        [c1, 50000, 44],
        [c1, 10000, 31],
        [c2, 25000, 55],
        [c2, 8000, 48],
        [c2, 12000, 36],
        [c2, 30000, 22],
        [c3, 40000, 78],
        [c3, 20000, 70],
        [c3, 15000, 62],
        [c1, 7500, 12],
        [c2, 5000, 6],
        [c1, 90000, 58],
        [c1, 60000, 47],
        [c2, 40000, 41],
      ] as [Campaign, number, number][])
        await donation(camp, DonationStatus.CONFIRMADA, cents, age);
      await donation(c1, DonationStatus.ESTORNADA, 20000, 40);
      await donation(c2, DonationStatus.PENDENTE, 10000, 1);
      await donation(c2, DonationStatus.CANCELADA, 6000, 3);

      const D = ExpenseDocumentKind;
      const e1 = await expense(org, u, {
        camp: c1,
        description: 'Compra de 120 cestas básicas',
        category: 'Alimentos',
        cents: 180000,
        ageDays: 40,
        supplier: 'Atacado Bom Preço Ltda',
        supplierDocument: '11222333000181',
        status: AccStatus.APROVADA,
        docs: [
          {
            kind: D.NOTA_FISCAL,
            status: AccStatus.APROVADA,
            publishable: true,
          },
          {
            kind: D.COMPROVANTE_PAGAMENTO,
            status: AccStatus.APROVADA,
            publishable: false,
          },
        ],
      });
      const e2 = await expense(org, u, {
        camp: c2,
        description: 'Kits de material escolar',
        category: 'Material escolar',
        cents: 95000,
        ageDays: 30,
        supplier: 'Papelaria Central Ltda',
        supplierDocument: '11222333000181',
        status: AccStatus.APROVADA,
        docs: [
          {
            kind: D.NOTA_FISCAL,
            status: AccStatus.APROVADA,
            publishable: true,
          },
          { kind: D.RECIBO, status: AccStatus.APROVADA, publishable: true },
        ],
      });
      await expense(org, u, {
        camp: c1,
        description: 'Transporte para a distribuição',
        category: 'Transporte',
        cents: 30000,
        ageDays: 25,
        supplier: 'Cooperativa de Transportes',
        supplierDocument: '11222333000181',
        status: AccStatus.APROVADA,
        docs: [
          { kind: D.RECIBO, status: AccStatus.APROVADA, publishable: true },
        ],
      });
      const e4 = await expense(org, u, {
        camp: c3,
        description: 'Materiais de construção da cozinha',
        category: 'Despesas operacionais',
        cents: 70000,
        ageDays: 55,
        supplier: 'Depósito Santa Rita',
        supplierDocument: '11222333000181',
        status: AccStatus.APROVADA,
        docs: [
          {
            kind: D.NOTA_FISCAL,
            status: AccStatus.APROVADA,
            publishable: true,
          },
        ],
      });
      await expense(org, u, {
        camp: c1,
        description: 'Compra de agasalhos',
        category: 'Outros',
        cents: 42000,
        ageDays: 5,
        supplier: 'Lojas Bom Frio',
        supplierDocument: '11222333000181',
        status: AccStatus.ENVIADA,
        docs: [
          {
            kind: D.NOTA_FISCAL,
            status: AccStatus.ENVIADA,
            publishable: false,
          },
        ],
      });
      await expense(org, u, {
        camp: c2,
        description: 'Mochilas para os kits',
        category: 'Material escolar',
        cents: 25000,
        ageDays: 9,
        supplier: 'João da Silva',
        supplierDocument: '52998224725',
        status: AccStatus.NECESSITA_COMPLEMENTACAO,
        reason: 'Envie também o comprovante de pagamento.',
        docs: [],
      });
      await expense(org, u, {
        camp: c1,
        description: 'Lanche da equipe',
        category: 'Despesas operacionais',
        cents: 18000,
        ageDays: 15,
        supplier: 'Padaria do Centro',
        supplierDocument: '11222333000181',
        status: AccStatus.REPROVADA,
        reason: 'Despesa fora da finalidade da campanha.',
        docs: [],
      });

      const d1 = await delivery(org, u, {
        camp: c1,
        expense: e1,
        item: 'Cestas básicas',
        bought: 120,
        given: 118,
        unit: 'cestas',
        text: 'Distribuição das cestas básicas a 118 famílias cadastradas, em dois dias de entrega.',
        ageDays: 33,
        region: 'Zona Leste - São Paulo/SP',
      });
      const d2 = await delivery(org, u, {
        camp: c2,
        expense: e2,
        item: 'Kits de material escolar',
        bought: 80,
        given: 80,
        unit: 'kits',
        text: 'Entrega de 80 kits às crianças do projeto de reforço escolar.',
        ageDays: 24,
        region: 'Bela Vista - São Paulo/SP',
      });
      const d3 = await delivery(org, u, {
        camp: c3,
        expense: e4,
        item: 'Reforma da cozinha',
        bought: 1,
        given: 1,
        unit: 'obra',
        text: 'Cozinha comunitária reformada e reaberta para as refeições do projeto.',
        ageDays: 45,
        region: 'Bela Vista - São Paulo/SP',
      });
      const A = AccStatus.APROVADA;
      await evidence(org, u, {
        delivery: d1,
        kind: EvidenceKind.FOTO_COMPRA,
        text: 'Cestas montadas antes da distribuição',
        ageDays: 34,
        status: A,
        publishable: true,
        n: 3,
      });
      await evidence(org, u, {
        delivery: d1,
        kind: EvidenceKind.FOTO_ENTREGA,
        text: 'Entrega das cestas à comunidade',
        ageDays: 33,
        status: A,
        publishable: true,
        n: 4,
      });
      await evidence(org, u, {
        delivery: d1,
        kind: EvidenceKind.FOTO_ACAO,
        text: 'Foto interna da equipe (não publicável)',
        ageDays: 33,
        status: A,
        publishable: false,
        n: 5,
      });
      await evidence(org, u, {
        delivery: d1,
        kind: EvidenceKind.FOTO_ACAO,
        text: 'Registro adicional aguardando análise',
        ageDays: 2,
        status: AccStatus.ENVIADA,
        publishable: false,
        n: 6,
      });
      await evidence(org, u, {
        delivery: d2,
        kind: EvidenceKind.FOTO_ENTREGA,
        text: 'Crianças recebendo os kits (rostos protegidos)',
        ageDays: 24,
        status: A,
        publishable: true,
        n: 7,
      });
      await evidence(org, u, {
        delivery: d2,
        kind: EvidenceKind.RELATORIO,
        text: 'Relatório de entrega dos kits',
        ageDays: 23,
        status: A,
        publishable: true,
        n: 8,
        asPdf: true,
      });
      await evidence(org, u, {
        delivery: d3,
        kind: EvidenceKind.FOTO_PRODUTO,
        text: 'Cozinha após a reforma',
        ageDays: 45,
        status: A,
        publishable: true,
        n: 9,
      });

      await post(org, u, {
        text: 'Boas-vindas ao nosso perfil! Aqui você acompanha cada ação, com compras, notas fiscais e fotos analisadas pela plataforma.',
        category: 'NOTICIA',
        ageDays: 80,
      });
      await post(
        org,
        u,
        {
          text: 'Entregamos 118 cestas básicas no fim de semana. Obrigado a todos os doadores!',
          category: 'ACAO_SOCIAL',
          ageDays: 33,
          campaignId: c1.id,
          deliveryRecordId: d1.id,
        },
        [
          { kind: 'IMAGEM', n: 10, status: A, publishable: true },
          { kind: 'IMAGEM', n: 11, status: A, publishable: true },
        ],
      );
      await post(
        org,
        u,
        {
          text: 'Resultado da campanha de cestas: compramos 120 cestas e a nota fiscal está disponível.',
          category: 'RESULTADO_CAMPANHA',
          ageDays: 38,
          expenseId: e1.id,
        },
        [
          {
            kind: 'DOCUMENTO',
            n: 12,
            status: A,
            publishable: true,
            name: 'resultado-campanha.pdf',
          },
        ],
      );
      await post(
        org,
        u,
        {
          text: 'Convidamos todos para a feira de adoção e doações do próximo sábado.',
          category: 'EVENTO',
          ageDays: 3,
        },
        [
          {
            kind: 'IMAGEM',
            n: 13,
            status: AccStatus.ENVIADA,
            publishable: false,
          },
        ],
      );
      await post(
        org,
        u,
        {
          text: 'Relatório de atividades do trimestre, com números de atendimentos e entregas.',
          category: 'RELATORIO',
          ageDays: 12,
        },
        [
          {
            kind: 'DOCUMENTO',
            n: 14,
            status: A,
            publishable: true,
            name: 'relatorio-trimestral.pdf',
          },
        ],
      );
      await post(
        org,
        u,
        {
          text: 'Kits de material escolar entregues às 80 crianças do projeto.',
          category: 'ENTREGA',
          ageDays: 24,
          campaignId: c2.id,
          deliveryRecordId: d2.id,
        },
        [{ kind: 'IMAGEM', n: 15, status: A, publishable: true }],
      );
      await post(
        org,
        u,
        {
          text: 'Bastidores da reforma da cozinha. A foto contém pessoas e ficou privada após a análise.',
          category: 'ATUALIZACAO',
          ageDays: 50,
        },
        [
          {
            kind: 'IMAGEM',
            n: 16,
            status: A,
            publishable: false,
            reason: 'Contém pessoas identificáveis',
          },
        ],
      );
    }
  }

  // ======================= ONG 8 — Bem Para Todos: pendências =======================
  {
    const u = U(8);
    const existing = await has(8);
    if (existing && existing.status !== OrganizationStatus.INCOMPLETO)
      console.log('ONG 8: já criada, pulando');
    else {
      console.log(
        'ONG 8: criando cenário "em desenvolvimento" (consultas externas reais)…',
      );
      await images(
        u,
        3,
        'Apoio a famílias do bairro com alimentos e orientação social.',
      );
      const base =
        existing ??
        (await orgRepo.save(
          orgOf(u, { cnpj: u.cnpj!.replace(/\D/g, ''), legalName: u.name }),
        ));
      await orgRepo.update(base.id, {
        tradeName: u.name,
        description:
          'Apoio a famílias do bairro com alimentos e orientação social.',
        email: u.email,
        phone: '11988887777',
        zip: '01310100',
        street: 'Avenida Paulista',
        number: '1000',
        district: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
        legalRepName: base.legalName,
        legalRepCpf: '52998224725',
        legalRepRole: 'Responsável legal',
        legalRepEmail: u.email,
        legalRepPhone: '11988887777',
      });
      const org = await orgRepo.findOneByOrFail({ id: base.id });
      const results = await checks.runAll(org, null); // consultas REAIS
      await submit(
        org,
        u,
        Object.fromEntries(results.map((r) => [r.source, r.status])),
      );
      await docs(org, u, allDocs(ReviewStatus.APROVADO, 80));
      await approve(org, u, 85, 78, {
        overrideReason: 'Cenário de teste (análise manual)',
      });

      const c1 = await campaign(org, u, {
        title: 'Ajuda alimentar para famílias do bairro',
        description:
          'Arrecadação para compra de alimentos para famílias atendidas no bairro.',
        objective: 'Atender 60 famílias',
        goal: 300000,
        status: CampaignStatus.ATIVA,
        startDays: 85,
        endDays: 30,
        n: 4,
      });
      for (const [cents, age] of [
        [15000, 82],
        [20000, 75],
        [10000, 70],
      ] as [number, number][])
        await donation(c1, DonationStatus.CONFIRMADA, cents, age);
      await donation(c1, DonationStatus.PENDENTE, 5000, 1);
      const D = ExpenseDocumentKind;
      await expense(org, u, {
        camp: c1,
        description: 'Compra de alimentos não perecíveis',
        category: 'Alimentos',
        cents: 30000,
        ageDays: 10,
        supplier: 'Mercadinho do Bairro',
        supplierDocument: '11222333000181',
        status: AccStatus.ENVIADA,
        docs: [
          {
            kind: D.NOTA_FISCAL,
            status: AccStatus.ENVIADA,
            publishable: false,
          },
        ],
      });
      const dl = await delivery(org, u, {
        camp: c1,
        item: 'Cestas de alimentos',
        bought: 20,
        given: 20,
        unit: 'cestas',
        text: 'Entrega de 20 cestas a famílias do bairro.',
        ageDays: 8,
        region: 'Bela Vista - São Paulo/SP',
      });
      await evidence(org, u, {
        delivery: dl,
        kind: EvidenceKind.FOTO_ENTREGA,
        text: 'Entrega das cestas (aguardando análise)',
        ageDays: 8,
        status: AccStatus.ENVIADA,
        publishable: false,
        n: 17,
      });
      await post(org, u, {
        text: 'Estamos começando! Acompanhe aqui as nossas ações no bairro.',
        category: 'NOTICIA',
        ageDays: 60,
      });
      await post(
        org,
        u,
        {
          text: 'Mutirão de arrecadação neste fim de semana na praça central.',
          category: 'EVENTO',
          ageDays: 7,
        },
        [
          {
            kind: 'IMAGEM',
            n: 18,
            status: AccStatus.ENVIADA,
            publishable: false,
          },
        ],
      );
    }
  }

  // ======================= ONG 2 — AACD Ibirapuera: pendente, cadastro completo =======================
  {
    const u = U(2);
    if (await has(2)) console.log('ONG 2: já criada, pulando');
    else {
      console.log('ONG 2: criando cenário "pendente de aprovação"…');
      await images(u, 0, IDENT[2].description);
      const org = await orgRepo.save(
        orgOf(u, {
          cnpj: IDENT[2].cnpj,
          legalName: IDENT[2].legalName,
          tradeName: IDENT[2].tradeName,
          description: IDENT[2].description,
          ...IDENT[2].address,
          status: OrganizationStatus.EM_ANALISE,
        }),
      );
      await ds.query(
        `UPDATE organizations SET "createdAt" = $1 WHERE id = $2`,
        [ago(6), org.id],
      );
      const results = await checks.runAll(org, null); // consultas REAIS
      await submit(
        org,
        u,
        Object.fromEntries(results.map((r) => [r.source, r.status])),
      );
      await docs(org, u, [
        ...allDocs(ReviewStatus.PENDENTE, 5),
        {
          type: OrganizationDocumentType.CARTAO_CNPJ,
          status: ReviewStatus.PENDENTE,
          ageDays: 5,
        },
      ]);
      await post(org, u, {
        text: 'Retomamos o reforço escolar com turmas novas. Em breve, mais novidades!',
        category: 'ATUALIZACAO',
        ageDays: 4,
      });
      await post(
        org,
        u,
        {
          text: 'Oficina de artes com as crianças.',
          category: 'ACAO_SOCIAL',
          ageDays: 2,
        },
        [
          {
            kind: 'IMAGEM',
            n: 19,
            status: AccStatus.ENVIADA,
            publishable: false,
          },
        ],
      );
    }
  }

  // ======================= ONG 3 — Instituto Vida Nova: pendente, vai ser reprovada =======================
  {
    const u = U(3);
    if (await has(3)) console.log('ONG 3: já criada, pulando');
    else {
      console.log(
        'ONG 3: criando cenário "pendente, com sinais de reprovação" (consultas externas reais)…',
      );
      await images(u, 5, IDENT[3].description);
      const org = await orgRepo.save(
        orgOf(u, {
          cnpj: IDENT[3].cnpj,
          legalName: IDENT[3].legalName,
          tradeName: IDENT[3].tradeName,
          description: IDENT[3].description,
          ...IDENT[3].address,
          email: u.email,
          status: OrganizationStatus.EM_ANALISE,
        }),
      );
      await ds.query(
        `UPDATE organizations SET "createdAt" = $1 WHERE id = $2`,
        [ago(10), org.id],
      );
      const results = await checks.runAll(org, null); // consultas REAIS: o CNPJ de teste não existe na Receita
      await submit(
        org,
        u,
        Object.fromEntries(results.map((r) => [r.source, r.status])),
      );
      await docs(org, u, [
        {
          type: OrganizationDocumentType.ESTATUTO,
          status: ReviewStatus.PENDENTE,
          ageDays: 9,
        },
        {
          type: OrganizationDocumentType.ATA_DIRETORIA,
          status: ReviewStatus.REPROVADO,
          reason: 'Documento ilegível e sem assinatura da diretoria.',
          ageDays: 9,
        },
        {
          type: OrganizationDocumentType.COMPROVANTE_ENDERECO,
          status: ReviewStatus.REPROVADO,
          reason: 'Endereço do comprovante diverge do cadastro.',
          ageDays: 9,
        },
        {
          type: OrganizationDocumentType.DOC_REPRESENTANTE,
          status: ReviewStatus.PENDENTE,
          ageDays: 9,
        },
      ]);
      await post(
        org,
        u,
        {
          text: 'Nossa instituição apoia centenas de famílias. Doe agora!',
          category: 'NOTICIA',
          ageDays: 8,
        },
        [
          {
            kind: 'IMAGEM',
            n: 20,
            status: AccStatus.REPROVADA,
            publishable: false,
            reason: 'Imagem de terceiros, sem autorização de uso.',
          },
        ],
      );
      await post(
        org,
        u,
        { text: 'Foto da nossa sede.', category: 'ATUALIZACAO', ageDays: 6 },
        [
          {
            kind: 'IMAGEM',
            n: 21,
            status: AccStatus.ENVIADA,
            publishable: false,
          },
        ],
      );
    }
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
