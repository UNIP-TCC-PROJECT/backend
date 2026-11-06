import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountabilityService } from '../accountability/accountability.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrganizationStatus } from '../organizations/entities/organization.entity';
import { UserType } from '../users/entities/user.entity';

// ---------- RBAC ----------
describe('RolesGuard', () => {
  class AdminRoute { @Roles(UserType.ADMIN) handler() {} }
  const ctx = (user: any): ExecutionContext => ({
    getHandler: () => AdminRoute.prototype.handler,
    getClass: () => AdminRoute,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;
  const guardFor = (dbUser: any) => new RolesGuard(new Reflector(), { findOne: async () => dbUser } as any);

  it.each([UserType.DOADOR, UserType.ONG])('nega rota de admin ao perfil %s', async (type) => {
    await expect(guardFor({ id: 1, type }).canActivate(ctx({ id: 1 }))).resolves.toBe(false);
  });

  it('nega administrador sem MFA verificado na sessão', async () => {
    await expect(guardFor({ id: 1, type: UserType.ADMIN }).canActivate(ctx({ id: 1, mfaVerified: false }))).rejects.toThrow(ForbiddenException);
  });

  it('permite administrador com MFA verificado e preserva a sessão em req.user', async () => {
    const req: any = { user: { id: 1, sid: 's', mfaVerified: true } };
    const c = { ...ctx(null), switchToHttp: () => ({ getRequest: () => req }) } as any;
    await expect(guardFor({ id: 1, type: UserType.ADMIN }).canActivate(c)).resolves.toBe(true);
    expect(req.user).toMatchObject({ sid: 's', mfaVerified: true, type: UserType.ADMIN });
  });
});

// ---------- Isolamento entre ONGs ----------
describe('Isolamento entre ONGs', () => {
  const orgA = { id: 'org-A', status: OrganizationStatus.APROVADA };
  const orgB = { id: 'org-B', status: OrganizationStatus.APROVADA };
  const orgOf: Record<number, any> = { 1: orgA, 2: orgB };
  const orgs = {
    ofOwner: jest.fn(async (uid: number) => orgOf[uid]),
    approvedOfOwner: jest.fn(async (uid: number) => orgOf[uid]),
  } as unknown as OrganizationsService;
  const audit = { log: jest.fn() } as any;

  it('ONG B não acessa campanha da ONG A (404, sem revelar existência)', async () => {
    const campaigns = { findOneBy: jest.fn(async ({ id, organizationId }) => (organizationId === 'org-A' ? { id } : null)) };
    const svc = new CampaignsService(campaigns as any, orgs, audit);
    await expect(svc.getMine(1, 'c1')).resolves.toMatchObject({ id: 'c1' });
    await expect(svc.getMine(2, 'c1')).rejects.toThrow(NotFoundException);
  });

  describe('prestação de contas', () => {
    const expenses = { findOneBy: jest.fn(async ({ organizationId }) => (organizationId === 'org-A' ? { id: 'e1', organizationId } : null)), save: jest.fn(), create: jest.fn() };
    const campaigns = { existsBy: jest.fn(async ({ organizationId }) => organizationId === 'org-A') };
    const docs = { findOne: jest.fn(async () => ({ id: 'd1', organizationId: 'org-A', name: 'nf.pdf', mime: 'application/pdf', content: Buffer.from('x') })), save: jest.fn(), create: jest.fn() };
    const svc = new AccountabilityService(expenses as any, docs as any, {} as any, {} as any, campaigns as any, {} as any, {} as any, {} as any, orgs, audit);

    it('ONG B não registra despesa em campanha da ONG A', async () => {
      const dto = { campaignId: 'c1', description: 'Compra de cestas', category: 'Alimentos', amountCents: 1000, spentAt: '2026-01-01' };
      await expect(svc.createExpense({ id: 2, type: 'ONG' }, dto)).rejects.toThrow(NotFoundException);
      expect(expenses.save).not.toHaveBeenCalled();
    });

    it('ONG B não envia comprovante para despesa da ONG A', async () => {
      await expect(svc.uploadExpenseDocument({ id: 2, type: 'ONG' }, 'e1', { kind: 'NOTA_FISCAL' } as any, undefined)).rejects.toThrow(NotFoundException);
    });

    it('ONG B não baixa comprovante da ONG A; dono e admin conseguem', async () => {
      await expect(svc.expenseDocumentFile({ id: 2, type: 'ONG' }, 'd1')).rejects.toThrow(NotFoundException);
      await expect(svc.expenseDocumentFile({ id: 1, type: 'ONG' }, 'd1')).resolves.toMatchObject({ id: 'd1' });
      await expect(svc.expenseDocumentFile({ id: 99, type: 'ADMIN' }, 'd1')).resolves.toMatchObject({ id: 'd1' });
    });
  });

  it('ONG não aprovada não cria campanha nem despesas (approvedOfOwner)', async () => {
    const usersRepo = {} as any;
    const orgRepo = { findOneBy: jest.fn(async () => ({ id: 'org-C', status: OrganizationStatus.REPROVADA })) } as any;
    const real = new OrganizationsService(orgRepo, {} as any, {} as any, usersRepo, {} as any, audit, {} as any);
    await expect(real.approvedOfOwner(3)).rejects.toThrow(ForbiddenException);
  });
});
