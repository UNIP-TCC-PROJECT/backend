import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User, UserStatus, UserType } from '../users/entities/user.entity';
import { ConversaSac } from './entities/conversa-sac.entity';
import { MensagemSac } from './entities/mensagem-sac.entity';

export interface UsuarioSac {
  id: number;
  type: UserType;
  mfaVerified?: boolean;
}

@Injectable()
export class SacService {
  constructor(
    @InjectRepository(ConversaSac)
    private readonly conversas: Repository<ConversaSac>,
    @InjectRepository(MensagemSac)
    private readonly mensagens: Repository<MensagemSac>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly db: DataSource,
  ) {}

  private async validarAcesso(usuario: UsuarioSac) {
    const ativo = await this.users.findOne({
      where: { id: usuario.id, type: usuario.type, status: UserStatus.ATIVO },
      select: { id: true },
    });
    if (
      !ativo ||
      ![UserType.DOADOR, UserType.ONG, UserType.ADMIN].includes(usuario.type)
    ) {
      throw new ForbiddenException(
        'O atendimento está disponível para contas ativas.',
      );
    }
    if (usuario.type === UserType.ADMIN && !usuario.mfaVerified) {
      throw new ForbiddenException(
        'Conclua a verificação em duas etapas para atender.',
      );
    }
  }

  async iniciar(usuario: UsuarioSac) {
    await this.validarAcesso(usuario);
    if (usuario.type === UserType.ADMIN) {
      throw new ForbiddenException(
        'Selecione o atendimento de um usuário para responder.',
      );
    }
    // Índice único e ON CONFLICT impedem duas conversas ao clicar em abas diferentes.
    await this.conversas
      .createQueryBuilder()
      .insert()
      .into(ConversaSac)
      .values({ usuarioId: usuario.id })
      .orIgnore()
      .execute();
    const conversa = await this.conversas.findOneByOrFail({
      usuarioId: usuario.id,
    });
    return { id: conversa.id };
  }

  async listar(usuario: UsuarioSac) {
    await this.validarAcesso(usuario);
    const query = this.conversas
      .createQueryBuilder('conversa')
      .leftJoin('conversa.usuario', 'usuario')
      .select([
        'conversa.id',
        'conversa.usuarioId',
        'conversa.createdAt',
        'conversa.ultimaMensagemEm',
        'usuario.id',
        'usuario.name',
        'usuario.type',
        'usuario.profileImage',
      ]);
    if (usuario.type !== UserType.ADMIN) {
      query.where('conversa.usuarioId = :id', { id: usuario.id });
    }
    return query
      .orderBy('conversa.ultimaMensagemEm', 'DESC', 'NULLS LAST')
      .addOrderBy('conversa.createdAt', 'DESC')
      .addOrderBy('conversa.id', 'DESC')
      .getMany();
  }

  private async autorizarConversa(id: number, usuario: UsuarioSac) {
    await this.validarAcesso(usuario);
    const where =
      usuario.type === UserType.ADMIN ? { id } : { id, usuarioId: usuario.id };
    const conversa = await this.conversas.findOne({ where });
    if (!conversa) throw new NotFoundException('Atendimento não encontrado.');
    return conversa;
  }

  async listarMensagens(id: number, usuario: UsuarioSac) {
    await this.autorizarConversa(id, usuario);
    return this.mensagens
      .createQueryBuilder('mensagem')
      .leftJoin('mensagem.remetente', 'remetente')
      .select([
        'mensagem.id',
        'mensagem.conversaId',
        'mensagem.remetenteId',
        'mensagem.texto',
        'mensagem.createdAt',
        'remetente.id',
        'remetente.name',
        'remetente.type',
      ])
      .where('mensagem.conversaId = :id', { id })
      .orderBy('mensagem.createdAt', 'ASC')
      .addOrderBy('mensagem.id', 'ASC')
      .getMany();
  }

  async enviar(id: number, usuario: UsuarioSac, recebido: string) {
    await this.autorizarConversa(id, usuario);
    const texto = typeof recebido === 'string' ? recebido.trim() : '';
    if (!texto || texto.length > 2000) {
      throw new BadRequestException(
        'Escreva uma mensagem de 1 a 2000 caracteres.',
      );
    }
    // A mensagem e a atualização da caixa de entrada são gravadas juntas.
    return this.db.transaction(async (manager) => {
      const mensagem = await manager.save(
        MensagemSac,
        manager.create(MensagemSac, {
          conversaId: id,
          remetenteId: usuario.id,
          texto,
        }),
      );
      await manager
        .createQueryBuilder()
        .update(ConversaSac)
        .set({ ultimaMensagemEm: () => 'GREATEST("ultimaMensagemEm", :data)' })
        .where('id = :id', { id })
        .setParameter('data', mensagem.createdAt)
        .execute();
      const remetente = await manager.findOneOrFail(User, {
        where: { id: usuario.id },
        select: { id: true, name: true, type: true },
      });
      return { ...mensagem, remetente };
    });
  }
}
