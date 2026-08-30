import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AdminActorValue } from './admin-actor';
import { hashPassword, verifyPassword } from './password';
import { CreateStaffDto } from './admin-auth.dto';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private username(value: string) {
    return value.trim().toLowerCase();
  }

  private async tenant() {
    return this.prisma.tenant.findUniqueOrThrow({ where: { slug: 'pizzburg' } });
  }

  async login(usernameInput: string, password: string) {
    const tenant = await this.tenant();
    const username = this.username(usernameInput);
    const user = await this.prisma.staffUser.findUnique({
      where: { tenantId_username: { tenantId: tenant.id, username } },
    });

    if (user) {
      if (!user.isActive || !(await verifyPassword(password, user.passwordHash))) {
        throw new UnauthorizedException('Неверный логин или пароль');
      }
      await this.prisma.staffUser.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      const token = await this.jwt.signAsync(
        {
          kind: 'admin',
          sub: user.id,
          tenantId: user.tenantId,
          sessionVersion: user.sessionVersion,
        },
        { expiresIn: '12h' },
      );
      return { token, user: this.publicUser(user) };
    }

    // Переходный вход: старый ADMIN_TOKEN остаётся ключом
    // владельца, пока он не создаст первый именной аккаунт.
    const namedOwnerExists = await this.prisma.staffUser.count({
      where: { tenantId: tenant.id, role: 'OWNER', isActive: true },
    });
    if (
      !namedOwnerExists && username === 'owner' &&
      process.env.ADMIN_TOKEN && password === process.env.ADMIN_TOKEN
    ) {
      const token = await this.jwt.signAsync(
        { kind: 'admin-legacy', tenantId: tenant.id },
        { expiresIn: '12h' },
      );
      return {
        token,
        user: {
          id: null,
          username: 'owner',
          displayName: 'Владелец',
          role: 'OWNER' as const,
          isActive: true,
          legacy: true,
        },
      };
    }

    throw new UnauthorizedException('Неверный логин или пароль');
  }

  async listStaff(tenantId: string) {
    const rows = await this.prisma.staffUser.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
    });
    return rows.map((row) => this.publicUser(row));
  }

  async createStaff(actor: AdminActorValue, dto: CreateStaffDto) {
    try {
      const user = await this.prisma.staffUser.create({
        data: {
          tenantId: actor.tenantId,
          username: this.username(dto.username),
          displayName: dto.displayName.trim(),
          passwordHash: await hashPassword(dto.password),
          role: dto.role,
        },
      });
      return this.publicUser(user);
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('Такой логин уже есть');
      throw error;
    }
  }

  async resetPassword(actor: AdminActorValue, id: string, password: string) {
    const target = await this.target(actor.tenantId, id);
    await this.prisma.staffUser.update({
      where: { id: target.id },
      data: {
        passwordHash: await hashPassword(password),
        sessionVersion: { increment: 1 },
      },
    });
    return { updated: true };
  }

  async setActive(actor: AdminActorValue, id: string, isActive: boolean) {
    const target = await this.target(actor.tenantId, id);
    if (actor.id === target.id && !isActive) {
      throw new BadRequestException('Нельзя отключить самого себя');
    }
    if (!isActive && target.role === 'OWNER') {
      const owners = await this.prisma.staffUser.count({
        where: { tenantId: actor.tenantId, role: 'OWNER', isActive: true },
      });
      if (owners <= 1) throw new ForbiddenException('Нельзя отключить последнего владельца');
    }
    const user = await this.prisma.staffUser.update({
      where: { id: target.id },
      data: {
        isActive,
        // Все ранее выданные JWT перестают работать сразу.
        sessionVersion: { increment: 1 },
      },
    });
    return this.publicUser(user);
  }

  private async target(tenantId: string, id: string) {
    const user = await this.prisma.staffUser.findFirst({ where: { id, tenantId } });
    if (!user) throw new BadRequestException('Сотрудник не найден');
    return user;
  }

  private publicUser(user: {
    id: string;
    username: string;
    displayName: string;
    role: 'OWNER' | 'CASHIER';
    isActive: boolean;
    lastLoginAt?: Date | null;
    createdAt?: Date;
  }) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt ?? null,
      legacy: false,
    };
  }
}
