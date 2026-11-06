import {
  Injectable,
  HttpException,
  HttpStatus,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import bcrypt from 'bcrypt';

import { User, UserType, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateProfileDto } from './dto/update-profile-dto';
import { CnpjVerificationService } from '../cnpj-verification/cnpj-verification.service';
import { BANKS } from '../common/banks';
import { normalizeWebsite } from '../common/br-validators';
import { BCRYPT_ROUNDS } from '../auth/auth.service';
import { CreateAdminDto } from '../admin/dto/create-admin-dto';

// Nunca devolve hash de senha nem campos internos (segredos MFA, vínculo com o provedor, contadores de bloqueio).
const INTERNAL_FIELDS = [
  'password',
  'mfaSecret',
  'asaasCustomerId',
  'failedLoginAttempts',
  'lockedUntil',
] as const;
export function sanitizeUser<T extends object>(user: T) {
  const copy = { ...user } as Record<string, unknown>;
  for (const f of INTERNAL_FIELDS) delete copy[f];
  return copy as Omit<T, (typeof INTERNAL_FIELDS)[number]>;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private repo: Repository<User>,
    private cnpjVerificationService: CnpjVerificationService,
  ) {}

  async create(data: CreateUserDto) {
    const existingUser = await this.repo.findOne({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('Email já cadastrado');
    }

    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    let preVerificacaoCnpj = false;

    if (data.type === UserType.ONG) {
      if (!data.cnpj) {
        throw new BadRequestException('CNPJ é obrigatório para ONGs');
      }

      const verificacao = await this.cnpjVerificationService.consultarCnpj(
        data.cnpj,
        data.name,
      );

      preVerificacaoCnpj = verificacao.verificacao.cnpjCompativel;
    }

    const user = this.repo.create({
      ...data,
      website: normalizeWebsite(data.website),
      // Banco da lista: o nome oficial vem do servidor, não do cliente.
      ...(data.bankCode ? { bank: BANKS[data.bankCode] } : { bankCode: null }),
      password: hashedPassword,
      status: UserStatus.ATIVO,
      preVerificacaoCnpj,
    });

    const savedUser = await this.repo.save(user);
    return sanitizeUser(savedUser);
  }

  async findById(id: number) {
    const user = await this.repo.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return sanitizeUser(user);
  }

  async updateCoverImage(userId: number, coverImage: string) {
    const user = await this.repo.findOne({
      where: { id: userId, type: UserType.ONG },
      select: ['id'],
    });
    if (!user) throw new NotFoundException('ONG não encontrada');
    await this.repo.update(userId, { coverImage });
    return { coverImage };
  }

  async updateProfileImage(userId: number, profileImage: string) {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }
    await this.repo.update(userId, { profileImage });
    return { profileImage };
  }

  async findAllUsers() {
    const users = await this.repo.find();
    return users.map(sanitizeUser);
  }

  async findAllOngs() {
    return this.repo.find({
      where: { type: UserType.ONG },
      select: [
        'id',
        'name',
        'email',
        'cnpj',
        'phone',
        'description',
        'whatsapp',
        'instagram',
        'website',
        'pixKey',
        'profileImage',
        'coverImage',
        'category',
        'city',
        'state',
        'createdAt',
        'averageRating',
        'totalReviews',
        'status',
      ],
    });
  }

  async findOngById(id: number) {
    const ong = await this.repo.findOne({
      where: {
        id,
        type: UserType.ONG,
      },
      select: [
        'id',
        'name',
        'email',
        'cnpj',
        'phone',
        'description',
        'whatsapp',
        'instagram',
        'website',
        'pixKey',
        'profileImage',
        'coverImage',
        'category',
        'city',
        'state',
        'createdAt',
        'averageRating',
        'totalReviews',
        'status',
      ],
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada');
    }

    return ong;
  }

  async updateProfile(id: number, data: UpdateProfileDto) {
    const user = await this.repo.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (data.email && data.email !== user.email) {
      const existingUser = await this.repo.findOne({
        where: { email: data.email },
      });

      if (existingUser) {
        throw new ConflictException('Email já cadastrado');
      }
    }

    const allowedFields = [
      'name',
      'email',
      'phone',
      'description',
      'zip',
      'street',
      'city',
      'state',
      'whatsapp',
      'instagram',
      'website',
      'profileImage',
    ];

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        Object.assign(user, {
          [field]: (data as any)[field],
        });
      }
    }

    const updatedUser = await this.repo.save(user);
    return sanitizeUser(updatedUser);
  }

  async updateOng(id: number, data: any, requestingUserId: number) {
    const ong = await this.repo.findOne({
      where: {
        id,
        type: UserType.ONG,
      },
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada');
    }

    if (ong.id !== requestingUserId) {
      throw new ForbiddenException('Você só pode editar o próprio perfil');
    }

    // O CNPJ foi verificado no cadastro (e sustenta o cadastro verificado): trocá-lo exige nova validação pela administração.
    if (
      data?.cnpj !== undefined &&
      String(data.cnpj).replace(/\D/g, '') !==
        String(ong.cnpj ?? '').replace(/\D/g, '')
    ) {
      throw new BadRequestException(
        'O CNPJ não pode ser alterado. Solicite a alteração à administração da plataforma.',
      );
    }
    delete data.cnpj;

    Object.assign(ong, data);

    const updatedOng = await this.repo.save(ong);
    return sanitizeUser(updatedOng);
  }

  async createAdmin(data: CreateAdminDto) {
    const existingUser = await this.repo.findOne({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('Email já cadastrado');
    }

    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    const admin = this.repo.create({
      name: data.name,
      email: data.email,
      password: hashedPassword,
      type: UserType.ADMIN,
      status: UserStatus.ATIVO,
    });

    const savedAdmin = await this.repo.save(admin);
    return sanitizeUser(savedAdmin);
  }
}
