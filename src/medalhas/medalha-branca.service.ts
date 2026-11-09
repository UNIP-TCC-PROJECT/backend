import {
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

/**
 * Histórico do antigo fluxo de solicitações da Medalha Branca. Os pedidos e documentos legados continuam consultáveis;
 * a Medalha Branca atual é concedida pela validação institucional e não depende desses pedidos antigos.
 */
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
        (ong.medalhaBrancaLegada
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
}
