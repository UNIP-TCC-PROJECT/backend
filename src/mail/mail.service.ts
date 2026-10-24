import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface PasswordResetEmailData {
  to: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;
  private readonly isProduction: boolean;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('MAIL_HOST');
    const port = Number(this.config.get<string>('MAIL_PORT') ?? 587);
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_PASS');

    this.from =
      this.config.get<string>('MAIL_FROM') ?? user ?? 'no-reply@localhost';
    this.isProduction = this.config.get<string>('NODE_ENV') === 'production';

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
      });
    } else {
      this.transporter = null;
      this.logger.warn(
        this.isProduction
          ? 'MAIL_HOST não configurado: os e-mails NÃO serão enviados.'
          : 'MAIL_HOST não configurado: os e-mails NÃO serão enviados. ' +
              'Em desenvolvimento, o link de recuperação aparece neste log.',
      );
    }
  }

  async sendPasswordResetEmail(data: PasswordResetEmailData): Promise<void> {
    const subject = 'Recuperação de senha';

    const text =
      `Olá, ${data.name}!\n\n` +
      `Recebemos um pedido para redefinir a sua senha.\n` +
      `Para criar uma nova senha, acesse o link abaixo (válido por ${data.expiresInMinutes} minutos e de uso único):\n\n` +
      `${data.resetUrl}\n\n` +
      `Se você não fez esse pedido, ignore este e-mail: a sua senha continua a mesma.`;

    const html =
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1f2937">` +
      `<h2 style="margin-bottom:16px">Recuperação de senha</h2>` +
      `<p>Olá, ${escapeHtml(data.name)}!</p>` +
      `<p>Recebemos um pedido para redefinir a sua senha. ` +
      `O link abaixo é válido por <strong>${data.expiresInMinutes} minutos</strong> e só pode ser usado uma vez.</p>` +
      `<p style="margin:24px 0">` +
      `<a href="${escapeHtml(data.resetUrl)}" ` +
      `style="background:#2563eb;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">` +
      `Criar nova senha</a></p>` +
      `<p style="font-size:13px;color:#6b7280">Se o botão não funcionar, copie e cole este endereço no navegador:<br>` +
      `${escapeHtml(data.resetUrl)}</p>` +
      `<p style="font-size:13px;color:#6b7280">Se você não fez esse pedido, ignore este e-mail: a sua senha continua a mesma.</p>` +
      `</div>`;

    if (!this.transporter) {
      // Sem servidor de e-mail configurado: só mostramos o link no log, e
      // apenas fora de produção (o link dá acesso à conta).
      if (!this.isProduction) {
        this.logger.log(
          `[DESENVOLVIMENTO] E-mail para ${data.to} | link de recuperação: ${data.resetUrl}`,
        );
      }
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: data.to,
      subject,
      text,
      html,
    });
  }
}
