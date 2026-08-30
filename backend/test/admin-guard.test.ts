import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { AdminGuard } from '../src/admin/admin.guard';

function fixture(options: { allowed?: StaffRole[]; active?: boolean; version?: number } = {}) {
  const request: any = { headers: { 'x-admin-token': 'employee-jwt' } };
  const reflector = { getAllAndOverride: () => options.allowed };
  const jwt = {
    verifyAsync: async () => ({ kind: 'admin', sub: 'u1', tenantId: 't1', sessionVersion: 3 }),
  };
  const prisma = {
    staffUser: {
      findUnique: async () => ({
        id: 'u1', tenantId: 't1', username: 'cashier', displayName: 'Кассир',
        role: StaffRole.CASHIER, isActive: options.active ?? true,
        sessionVersion: options.version ?? 3,
      }),
    },
  };
  const context: any = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  };
  return { guard: new AdminGuard(reflector as any, jwt as any, prisma as any), context, request };
}

test('новый админский endpoint по умолчанию закрыт от кассира', async () => {
  const { guard, context } = fixture();
  await assert.rejects(() => guard.canActivate(context), ForbiddenException);
});

test('явно разрешённый кассирский endpoint пропускает и прикрепляет автора', async () => {
  const { guard, context, request } = fixture({ allowed: [StaffRole.OWNER, StaffRole.CASHIER] });
  assert.equal(await guard.canActivate(context), true);
  assert.equal(request.adminActor.displayName, 'Кассир');
});

test('отключённый сотрудник теряет доступ даже с ещё живым JWT', async () => {
  const { guard, context } = fixture({ allowed: [StaffRole.CASHIER], active: false });
  await assert.rejects(() => guard.canActivate(context), UnauthorizedException);
});

test('смена пароля отзывает прежние сессии через sessionVersion', async () => {
  const { guard, context } = fixture({ allowed: [StaffRole.CASHIER], version: 4 });
  await assert.rejects(() => guard.canActivate(context), UnauthorizedException);
});
