import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { User, UserType } from '../users/entities/user.entity';
import { ConversaSac } from './entities/conversa-sac.entity';
import { MensagemSac } from './entities/mensagem-sac.entity';
import { SacService } from './sac.service';

describe('Privacidade do SAC', () => {
  const criar = (ativo = true) => {
    const conversas = { findOne: jest.fn().mockResolvedValue(null) };
    const users = {
      findOne: jest.fn().mockResolvedValue(ativo ? { id: 1 } : null),
    };
    const mensagens = { createQueryBuilder: jest.fn() };
    const db = { transaction: jest.fn() };
    const service = new SacService(
      conversas as unknown as Repository<ConversaSac>,
      mensagens as unknown as Repository<MensagemSac>,
      users as unknown as Repository<User>,
      db as unknown as DataSource,
    );
    return { service, conversas, mensagens, db };
  };

  it.each([UserType.DOADOR, UserType.ONG])(
    'perfil %s não lê nem escreve na conversa alheia',
    async (type) => {
      const { service, conversas, mensagens, db } = criar();
      const usuario = { id: 2, type };
      await expect(service.listarMensagens(10, usuario)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.enviar(10, usuario, 'Mensagem')).rejects.toThrow(
        NotFoundException,
      );
      expect(conversas.findOne).toHaveBeenCalledWith({
        where: { id: 10, usuarioId: 2 },
      });
      expect(mensagens.createQueryBuilder).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );

  it('administrador precisa concluir o MFA antes de ler ou responder', async () => {
    const { service, conversas, db } = criar();
    const admin = { id: 1, type: UserType.ADMIN, mfaVerified: false };
    await expect(service.listar(admin)).rejects.toThrow(ForbiddenException);
    await expect(service.enviar(10, admin, 'Resposta')).rejects.toThrow(
      ForbiddenException,
    );
    expect(conversas.findOne).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('conta inativa perde acesso mesmo com sessão previamente válida', async () => {
    const { service, conversas, db } = criar(false);
    const usuario = { id: 1, type: UserType.DOADOR };
    await expect(service.iniciar(usuario)).rejects.toThrow(ForbiddenException);
    await expect(service.listarMensagens(10, usuario)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.enviar(10, usuario, 'Mensagem')).rejects.toThrow(
      ForbiddenException,
    );
    expect(conversas.findOne).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
