import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Interesse } from '../interesses/entities/interesse.entity';
import { User, UserStatus, UserType } from '../users/entities/user.entity';
import { Conversa } from './entities/conversa.entity';
import { Mensagem } from './entities/mensagem.entity';

interface UsuarioAutenticado {
  id: number;
  type: UserType;
  status: UserStatus;
}

@Injectable()
export class ConversasService {
  constructor(
    @InjectRepository(Conversa)
    private readonly conversasRepository: Repository<Conversa>,
    @InjectRepository(Mensagem)
    private readonly mensagensRepository: Repository<Mensagem>,
    @InjectRepository(Interesse)
    private readonly interessesRepository: Repository<Interesse>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async iniciarPorDoador(doadorId: number, ongId: number) {
    await this.validarUsuarioAtivo(doadorId, UserType.DOADOR);
    await this.validarUsuarioAtivo(ongId, UserType.ONG);
    return this.obterOuCriarConversa(doadorId, ongId);
  }

  async iniciarPorOng(ongId: number, doadorId: number) {
    await this.validarUsuarioAtivo(ongId, UserType.ONG);
    await this.validarUsuarioAtivo(doadorId, UserType.DOADOR);

    const demonstrouInteresse = await this.interessesRepository.exist({
      where: { doadorId, ongId },
    });

    if (!demonstrouInteresse) {
      throw new ForbiddenException(
        'A ONG só pode iniciar contato com doadores interessados em ajudá-la.',
      );
    }

    return this.obterOuCriarConversa(doadorId, ongId);
  }

  async listar(usuario: UsuarioAutenticado) {
    await this.validarParticipanteAtivo(usuario);

    const query = this.conversasRepository
      .createQueryBuilder('conversa')
      .leftJoinAndSelect('conversa.doador', 'doador')
      .leftJoinAndSelect('conversa.ong', 'ong')
      .select([
        'conversa.id',
        'conversa.doadorId',
        'conversa.ongId',
        'conversa.ultimaMensagemEm',
        'conversa.createdAt',
        'doador.id',
        'doador.name',
        'doador.profileImage',
        'ong.id',
        'ong.name',
        'ong.profileImage',
      ]);

    if (usuario.type === UserType.DOADOR) {
      query.where('conversa.doadorId = :usuarioId', { usuarioId: usuario.id });
    } else {
      query.where('conversa.ongId = :usuarioId', { usuarioId: usuario.id });
    }

    return query
      .orderBy('conversa.ultimaMensagemEm', 'DESC', 'NULLS LAST')
      .addOrderBy('conversa.createdAt', 'DESC')
      .getMany();
  }

  async listarMensagens(conversaId: number, usuario: UsuarioAutenticado) {
    await this.buscarConversaDoParticipante(conversaId, usuario);

    return this.mensagensRepository.find({
      where: { conversaId },
      select: {
        id: true,
        conversaId: true,
        remetenteId: true,
        texto: true,
        createdAt: true,
      },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async enviarMensagem(
    conversaId: number,
    usuario: UsuarioAutenticado,
    textoRecebido: string,
  ) {
    const conversa = await this.buscarConversaDoParticipante(conversaId, usuario);
    const texto = textoRecebido.trim();

    if (!texto) {
      throw new BadRequestException('A mensagem não pode estar vazia.');
    }

    if (texto.length > 2000) {
      throw new BadRequestException('A mensagem deve ter até 2000 caracteres.');
    }

    const mensagem = await this.mensagensRepository.save(
      this.mensagensRepository.create({
        conversaId: conversa.id,
        remetenteId: usuario.id,
        texto,
      }),
    );

    conversa.ultimaMensagemEm = mensagem.createdAt;
    await this.conversasRepository.save(conversa);

    return {
      id: mensagem.id,
      conversaId: mensagem.conversaId,
      remetenteId: mensagem.remetenteId,
      texto: mensagem.texto,
      createdAt: mensagem.createdAt,
    };
  }

  private async obterOuCriarConversa(doadorId: number, ongId: number) {
    const existente = await this.conversasRepository.findOne({
      where: { doadorId, ongId },
    });

    if (existente) return existente;

    const conversa = this.conversasRepository.create({ doadorId, ongId });
    return this.conversasRepository.save(conversa);
  }

  private async buscarConversaDoParticipante(
    conversaId: number,
    usuario: UsuarioAutenticado,
  ) {
    await this.validarParticipanteAtivo(usuario);

    const where =
      usuario.type === UserType.DOADOR
        ? { id: conversaId, doadorId: usuario.id }
        : { id: conversaId, ongId: usuario.id };

    const conversa = await this.conversasRepository.findOne({ where });

    if (!conversa) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    return conversa;
  }

  private async validarParticipanteAtivo(usuario: UsuarioAutenticado) {
    if (
      usuario.type !== UserType.DOADOR &&
      usuario.type !== UserType.ONG
    ) {
      throw new ForbiddenException('Acesso permitido somente a doadores e ONGs.');
    }

    await this.validarUsuarioAtivo(usuario.id, usuario.type);
  }

  private async validarUsuarioAtivo(id: number, type: UserType) {
    const usuario = await this.usersRepository.findOne({
      where: { id, type, status: UserStatus.ATIVO },
      select: { id: true },
    });

    if (!usuario) {
      throw new ForbiddenException('Ação permitida somente a contas ativas.');
    }
  }
}
