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

import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';

import { User, UserType, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateProfileDto } from './dto/update-profile-dto';
import { CnpjVerificationService } from '../cnpj-verification/cnpj-verification.service';
import { cpfValido } from './cpf-validation';
import { pixKeyValida } from './pix-key-validation';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { CreateAdminDto } from '../admin/dto/create-admin-dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private repo: Repository<User>,
    private jwtService: JwtService,
    private cnpjVerificationService: CnpjVerificationService,
  ) {}

  async create(data: CreateUserDto) {
    const existingUser = await this.repo.findOne({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('Email já cadastrado');
    }
    if (data.type === UserType.ONG && !pixKeyValida(data.pixKey)) {
      throw new BadRequestException(
        'Informe uma chave PIX válida: CPF, CNPJ, e-mail, celular brasileiro com DDD ou chave aleatória UUID.',
      );
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    let medalhaVerde = false;

    if (data.type === UserType.ONG) {
      if (!data.cnpj) {
        throw new BadRequestException('CNPJ é obrigatório para ONGs');
      }

      const verificacao = await this.cnpjVerificationService.consultarCnpj(
        data.cnpj,
        data.name,
      );

      medalhaVerde = verificacao.verificacao.medalhaVerde;
    }
    if (data.type === UserType.ONG && !cpfValido(data.legalCpf)) {
      throw new BadRequestException('O CPF do responsável legal é inválido.');
    }

    if (data.type === UserType.DOADOR && !cpfValido(data.cpf)) {
      throw new BadRequestException('O CPF informado é inválido.');
    }

    const pixKeyInformada = data.pixKey?.trim();
    const telefoneCelularNacional = pixKeyInformada
      ? /^(?:[1-9]\d9\d{8}|\([1-9]\d\)\s?9\d{4}-?\d{4})$/.test(
          pixKeyInformada,
        )
      : false;
    const pixKeyNormalizada = telefoneCelularNacional
      ? `+55${pixKeyInformada.replace(/\D/g, '')}`
      : pixKeyInformada;

    const user = this.repo.create({
      ...data,
      ...(data.type === UserType.ONG && pixKeyNormalizada
        ? { pixKey: pixKeyNormalizada }
        : {}),
      password: hashedPassword,
      status: UserStatus.ATIVO,
      medalhaVerde,
    });

    const savedUser = await this.repo.save(user);
    const { password, ...result } = savedUser;

    return result;
  }

  async login(email: string, password: string) {
    const user = await this.repo.findOne({
      where: { email },
    });

    if (!user) {
      throw new HttpException(
        'Email ou senha inválidos',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new HttpException(
        'Email ou senha inválidos',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.status !== UserStatus.ATIVO) {
      throw new ForbiddenException('Esta conta não está ativa');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      type: user.type,
      status: user.status,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return { access_token: accessToken };
  }

  async findById(id: number) {
    const user = await this.repo.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const { password, ...result } = user;
    return result;
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
    return users.map(({ password, ...rest }) => rest);
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
        'category',
        'city',
        'state',
        'createdAt',
        'averageRating',
        'totalReviews',
        'status',
        'medalhaVerde',
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
        'category',
        'city',
        'state',
        'createdAt',
        'averageRating',
        'totalReviews',
        'status',
        'medalhaVerde',
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
    const { password, ...result } = updatedUser;

    return result;
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

    Object.assign(ong, data);

    const updatedOng = await this.repo.save(ong);
    const { password, ...result } = updatedOng;

    return result;
  }

  async createAdmin(data: CreateAdminDto) {
    const existingUser = await this.repo.findOne({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('Email já cadastrado');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const admin = this.repo.create({
      name: data.name,
      email: data.email,
      password: hashedPassword,
      type: UserType.ADMIN,
      status: UserStatus.ATIVO,
    });

    const savedAdmin = await this.repo.save(admin);
    const { password, ...result } = savedAdmin;

    return result;
  }
}
