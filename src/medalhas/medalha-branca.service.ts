import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { User, UserStatus, UserType } from '../users/entities/user.entity';
import {
  DocumentoMedalhaBranca,
  PedidoMedalhaBranca,
  StatusMedalhaBranca,
} from './entities/pedido-medalha-branca.entity';
import { AnalisarMedalhaBrancaDto } from './dto/analisar-medalha-branca.dto';
import { nomeDocumento, validarDocumentos } from './medalha-branca.upload';

@Injectable()
export class MedalhaBrancaService {
  constructor(private readonly db: DataSource) {}

  async listar(ongId: number) {
    const ong = await this.db
      .getRepository(User)
      .findOneBy({ id: ongId, type: UserType.ONG });
    if (!ong) throw new NotFoundException('ONG não encontrada.');
    const pedidos = await this.db.getRepository(PedidoMedalhaBranca).find({
      where: { ongId },
      order: { id: 'DESC' },
    });
    const documentos = pedidos.length
      ? await this.db.getRepository(DocumentoMedalhaBranca).find({
          where: { solicitacaoId: In(pedidos.map((p) => p.id)) },
          select: ['id', 'solicitacaoId', 'nome', 'tipo', 'tamanho'],
          order: { nome: 'ASC', id: 'ASC' },
        })
      : [];
    return {
      status:
        pedidos[0]?.status ??
        (ong.medalhaBranca
          ? StatusMedalhaBranca.Aprovado
          : StatusMedalhaBranca.NaoSolicitado),
      solicitacoes: pedidos.map((p) => ({
        id: p.id,
        status: p.status,
        createdAt: p.createdAt,
        motivo: p.motivo,
        analisadoEm: p.analisadoEm,
        documentos: documentos.filter((d) => d.solicitacaoId === p.id),
      })),
    };
  }

  async solicitar(ongId: number, files: Express.Multer.File[]) {
    validarDocumentos(files);
    await this.db.transaction(async (manager) => {
      // Serializa envios da mesma ONG, inclusive duas abas enviando juntas.
      const ong = await manager.findOne(User, {
        where: { id: ongId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !ong ||
        ong.type !== UserType.ONG ||
        ong.status !== UserStatus.ATIVO
      ) {
        throw new ForbiddenException(
          'Somente ONGs ativas podem solicitar a medalha.',
        );
      }
      const atual = await manager.findOne(PedidoMedalhaBranca, {
        where: { ongId },
        order: { id: 'DESC' },
      });
      if (atual?.status === StatusMedalhaBranca.Pendente) {
        throw new ConflictException(
          'Sua solicitação já está pendente de análise.',
        );
      }
      if (ong.medalhaBranca || atual?.status === StatusMedalhaBranca.Aprovado) {
        throw new ConflictException('Sua ONG já possui a Medalha Branca.');
      }
      const pedido = await manager.save(
        PedidoMedalhaBranca,
        manager.create(PedidoMedalhaBranca, {
          ongId,
          status: StatusMedalhaBranca.Pendente,
        }),
      );
      await manager.save(
        DocumentoMedalhaBranca,
        files.map((file) =>
          manager.create(DocumentoMedalhaBranca, {
            solicitacaoId: pedido.id,
            nome: nomeDocumento(file.originalname),
            tipo: file.mimetype,
            tamanho: file.buffer.length,
            conteudo: file.buffer,
          }),
        ),
      );
    });
    return this.listar(ongId);
  }

  async documento(
    id: string,
    usuario: { id: number; type: UserType; status: UserStatus },
  ) {
    if (
      usuario.status !== UserStatus.ATIVO ||
      ![UserType.ONG, UserType.ADMIN].includes(usuario.type)
    ) {
      throw new ForbiddenException('Acesso não permitido.');
    }
    const repo = this.db.getRepository(DocumentoMedalhaBranca);
    const documento = await repo.findOneBy({ id });
    if (!documento) throw new NotFoundException('Documento não encontrado.');
    const pedido = await this.db.getRepository(PedidoMedalhaBranca).findOneBy({
      id: documento.solicitacaoId,
      ...(usuario.type === UserType.ADMIN ? {} : { ongId: usuario.id }),
    });
    if (!pedido) throw new NotFoundException('Documento não encontrado.');
    return repo.findOneOrFail({
      where: { id },
      select: ['id', 'nome', 'tipo', 'tamanho', 'conteudo'],
    });
  }

  async analisar(id: number, adminId: number, dto: AnalisarMedalhaBrancaDto) {
    if (
      ![StatusMedalhaBranca.Aprovado, StatusMedalhaBranca.Recusado].includes(
        dto.status,
      )
    ) {
      throw new BadRequestException('Decisão inválida.');
    }
    const motivo = dto.motivo?.trim() || null;
    if (dto.status === StatusMedalhaBranca.Recusado && !motivo) {
      throw new BadRequestException('Informe o motivo da recusa.');
    }
    const ongId = await this.db.transaction(async (manager) => {
      const admin = await manager.findOneBy(User, {
        id: adminId,
        type: UserType.ADMIN,
        status: UserStatus.ATIVO,
      });
      if (!admin) throw new ForbiddenException('Administrador sem permissão.');
      const referencia = await manager.findOneBy(PedidoMedalhaBranca, { id });
      if (!referencia)
        throw new NotFoundException('Solicitação não encontrada.');
      await manager.findOneOrFail(User, {
        where: { id: referencia.ongId },
        lock: { mode: 'pessimistic_write' },
      });
      const pedido = await manager.findOneOrFail(PedidoMedalhaBranca, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (pedido.status !== StatusMedalhaBranca.Pendente) {
        throw new ConflictException('Esta solicitação já foi analisada.');
      }
      await manager.update(PedidoMedalhaBranca, id, {
        status: dto.status,
        motivo,
        analisadoEm: new Date(),
        analisadoPor: adminId,
      });
      if (dto.status === StatusMedalhaBranca.Aprovado) {
        await manager.update(User, pedido.ongId, { medalhaBranca: true });
      }
      return pedido.ongId;
    });
    return this.listar(ongId);
  }
}
