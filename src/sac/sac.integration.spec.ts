import 'dotenv/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { dbOptions } from '../database/database.config';
import { User, UserStatus, UserType } from '../users/entities/user.entity';
import { ConversaSac } from './entities/conversa-sac.entity';
import { MensagemSac } from './entities/mensagem-sac.entity';
import { SacService, UsuarioSac } from './sac.service';

// Opt-in: exige banco com a migration aplicada. Todas as fixtures e mensagens
// ficam em uma única transação, revertida ao terminar, inclusive em falhas.
const suite = process.env.SAC_DB_TEST === '1' ? describe : describe.skip;
suite('SAC com PostgreSQL e permissões do papel runtime', () => {
  let db: DataSource;
  let runner: QueryRunner;
  let service: SacService;
  let doador: UsuarioSac;
  let ong: UsuarioSac;
  let admin: UsuarioSac;
  let outroAdmin: UsuarioSac;
  let conversa: number;
  let conversaOng: number;
  let contagemAntes: number;

  beforeAll(async () => {
    db = await new DataSource({
      ...dbOptions('runtime'),
      logging: false,
    }).initialize();
    runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const manager = runner.manager;
    contagemAntes = await manager.count(ConversaSac);
    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const criar = async (
      type: UserType,
      indice: number,
    ): Promise<UsuarioSac> => {
      const user = await manager.save(
        User,
        manager.create(User, {
          name: `Teste SAC ${type} ${indice}`,
          email: `sac-${token}-${indice}@example.invalid`,
          password: 'fixture-sem-senha-utilizavel',
          type,
          status: UserStatus.ATIVO,
        }),
      );
      return { id: user.id, type, mfaVerified: type === UserType.ADMIN };
    };
    doador = await criar(UserType.DOADOR, 1);
    ong = await criar(UserType.ONG, 2);
    admin = await criar(UserType.ADMIN, 3);
    outroAdmin = await criar(UserType.ADMIN, 4);
    // Cada transação de envio usa savepoint na mesma conexão para que o rollback
    // externo também remova mensagens e conversas criadas durante o teste.
    service = new SacService(
      manager.getRepository(ConversaSac),
      manager.getRepository(MensagemSac),
      manager.getRepository(User),
      { transaction: manager.transaction.bind(manager) } as DataSource,
    );
  }, 30000);

  afterAll(async () => {
    try {
      if (runner?.isTransactionActive) await runner.rollbackTransaction();
      if (runner) await runner.release();
      if (db?.isInitialized) {
        expect(await db.getRepository(User).existsBy({ id: doador?.id })).toBe(
          false,
        );
        expect(await db.getRepository(ConversaSac).count()).toBe(contagemAntes);
      }
    } finally {
      if (db?.isInitialized) await db.destroy();
    }
  });

  it('doador inicia e retorna à mesma conversa', async () => {
    const primeira = await service.iniciar(doador);
    conversa = primeira.id;
    expect(await service.iniciar(doador)).toEqual(primeira);
  });

  it('ONG inicia atendimento sem exigir validação institucional ou doação', async () => {
    conversaOng = (await service.iniciar(ong)).id;
    expect(conversaOng).not.toBe(conversa);
  });

  it('cada participante vê somente sua conversa; administradores veem ambas', async () => {
    expect((await service.listar(doador)).map((c) => c.id)).toEqual([conversa]);
    expect((await service.listar(ong)).map((c) => c.id)).toEqual([conversaOng]);
    for (const pessoa of [admin, outroAdmin]) {
      expect((await service.listar(pessoa)).map((c) => c.id)).toEqual(
        expect.arrayContaining([conversa, conversaOng]),
      );
    }
  });

  it('nega leitura e envio cruzados entre ONG e doador', async () => {
    await expect(service.listarMensagens(conversa, ong)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.enviar(conversa, ong, 'Invasão')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.listarMensagens(conversaOng, doador)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.enviar(conversaOng, doador, 'Invasão'),
    ).rejects.toThrow(NotFoundException);
  });

  it('grava a mensagem do doador e respostas de dois administradores em ordem', async () => {
    const pergunta = await service.enviar(
      conversa,
      doador,
      '  Preciso de ajuda  ',
    );
    expect(pergunta).toMatchObject({
      texto: 'Preciso de ajuda',
      remetenteId: doador.id,
    });
    await service.enviar(conversa, admin, 'Como podemos ajudar?');
    await service.enviar(conversa, outroAdmin, 'Vou acompanhar o atendimento.');
    const mensagens = await service.listarMensagens(conversa, doador);
    expect(mensagens.map((m) => m.remetenteId)).toEqual([
      doador.id,
      admin.id,
      outroAdmin.id,
    ]);
    expect(mensagens[1].remetente.type).toBe(UserType.ADMIN);
    expect((await service.listar(doador))[0].ultimaMensagemEm).toBeInstanceOf(
      Date,
    );
  });

  it('ONG também troca mensagens com a administração', async () => {
    await service.enviar(conversaOng, ong, 'Dúvida da ONG');
    await service.enviar(conversaOng, admin, 'Resposta à ONG');
    expect(
      (await service.listarMensagens(conversaOng, ong)).map((m) => m.texto),
    ).toEqual(['Dúvida da ONG', 'Resposta à ONG']);
  });

  it('não expõe senha, email, documentos ou segredo de MFA nas respostas', async () => {
    const dados = [
      ...(await service.listar(admin)),
      ...(await service.listarMensagens(conversa, admin)),
    ];
    const json = JSON.stringify(dados);
    for (const campo of ['password', 'email', 'cpf', 'cnpj', 'mfaSecret'])
      expect(json).not.toContain(`"${campo}"`);
  });

  it.each(['', '   ', 'a'.repeat(2001)])(
    'recusa texto vazio ou acima do limite (%#)',
    async (texto) => {
      await expect(service.enviar(conversa, doador, texto)).rejects.toThrow(
        BadRequestException,
      );
      expect(
        await runner.manager.countBy(MensagemSac, { conversaId: conversa }),
      ).toBe(3);
    },
  );

  it('aceita o limite de 2000 caracteres', async () => {
    expect(
      (await service.enviar(conversa, doador, 'a'.repeat(2000))).texto,
    ).toHaveLength(2000);
  });

  it('admin sem MFA não acessa mensagens e não responde', async () => {
    const semMfa = { ...admin, mfaVerified: false };
    await expect(service.listarMensagens(conversa, semMfa)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.enviar(conversa, semMfa, 'Resposta')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('admin atende usuários, sem criar atendimento para si próprio', async () => {
    await expect(service.iniciar(admin)).rejects.toThrow(ForbiddenException);
  });

  it('suspensão da conta bloqueia uma conversa já existente', async () => {
    await runner.manager.update(User, doador.id, {
      status: UserStatus.SUSPENSO,
    });
    await expect(service.listarMensagens(conversa, doador)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.enviar(conversa, doador, 'Tentativa')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
