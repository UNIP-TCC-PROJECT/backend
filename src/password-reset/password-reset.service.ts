import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';

import { Session } from '../auth/entities/session.entity';
import { BCRYPT_ROUNDS } from '../auth/auth.service';
import { User, UserStatus } from '../users/entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { MailService } from '../mail/mail.service';

// Quanto tempo o link vale.
const TOKEN_TTL_MINUTES = 30;
// Depois de um pedido, a mesma conta só recebe outro e-mail após esse tempo.
const REQUEST_COOLDOWN_SECONDS = 60;
// Máximo de e-mails de recuperação por conta em 1 hora.
const MAX_REQUESTS_PER_HOUR = 5;

// A resposta é SEMPRE esta, exista o e-mail no sistema ou não.
export const FORGOT_PASSWORD_MESSAGE =
  'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(PasswordResetToken)
    private readonly tokenRepository: Repository<PasswordResetToken>,

    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  async requestReset(email: string): Promise<{ message: string }> {
    // Comparação sem diferenciar maiúsculas de minúsculas.
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (user && user.status === UserStatus.ATIVO) {
      await this.issueToken(user);
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const record = await this.tokenRepository.findOne({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!record) {
      throw new BadRequestException('Link inválido.');
    }

    if (record.usedAt) {
      throw new BadRequestException('Este link já foi utilizado.');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Este link expirou. Solicite um novo link de recuperação.',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.dataSource.transaction(async (manager) => {
      // "Reserva" o token de forma atômica: só um pedido consegue marcar
      // usedAt (mesmo que dois cliques cheguem ao mesmo tempo).
      const claim = await manager.update(
        PasswordResetToken,
        { id: record.id, usedAt: IsNull() },
        { usedAt: new Date() },
      );

      if (!claim.affected) {
        throw new BadRequestException('Este link já foi utilizado.');
      }

      await manager.update(
        User,
        { id: record.userId },
        { password: hashedPassword },
      );

      // Trocar a senha encerra todas as sessões abertas da conta.
      await manager.update(
        Session,
        { userId: record.userId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );

      // Qualquer outro link ainda pendente dessa conta deixa de valer.
      await manager.update(
        PasswordResetToken,
        { userId: record.userId, usedAt: IsNull() },
        { expiresAt: new Date() },
      );
    });

    return { message: 'Senha redefinida com sucesso.' };
  }

  private async issueToken(user: User): Promise<void> {
    const now = Date.now();

    // Limite por conta: espera mínima entre pedidos...
    const lastToken = await this.tokenRepository.findOne({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });

    if (
      lastToken &&
      now - lastToken.createdAt.getTime() < REQUEST_COOLDOWN_SECONDS * 1000
    ) {
      return;
    }

    // ...e máximo de pedidos por hora.
    const recentCount = await this.tokenRepository.count({
      where: {
        userId: user.id,
        createdAt: MoreThan(new Date(now - 60 * 60 * 1000)),
      },
    });

    if (recentCount >= MAX_REQUESTS_PER_HOUR) {
      return;
    }

    // Token aleatório de 256 bits. O valor "cru" só vai no e-mail.
    const rawToken = randomBytes(32).toString('hex');

    // Um novo pedido invalida os links anteriores ainda não usados.
    await this.tokenRepository.update(
      { userId: user.id, usedAt: IsNull() },
      { expiresAt: new Date() },
    );

    await this.tokenRepository.save(
      this.tokenRepository.create({
        userId: user.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(now + TOKEN_TTL_MINUTES * 60 * 1000),
        usedAt: null,
      }),
    );

    const frontendUrl = (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'
    ).replace(/\/+$/, '');

    const resetUrl = `${frontendUrl}/redefinir-senha?token=${rawToken}`;

    // Sem "await": a resposta da API não depende do envio do e-mail
    // (assim ela demora o mesmo tempo exista a conta ou não).
    void this.mailService
      .sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
        expiresInMinutes: TOKEN_TTL_MINUTES,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Falha ao enviar e-mail de recuperação: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
