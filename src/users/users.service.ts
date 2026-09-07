
import {
  Injectable,
  HttpException,
  HttpStatus,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';

import { User, UserType, UserStatus } from './entities/user.entity';

import { CnpjVerificationService } from '../cnpj-verification/cnpj-verification.service';

import type { JwtPayload } from '../auth/jwt-payload.interface';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private repo: Repository<User>,

    private jwtService: JwtService,

    private cnpjVerificationService: CnpjVerificationService,
  ) {}

  async create(data: any) {
    const existingUser = await this.repo.findOne({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('Email já cadastrado');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    let medalhaVerde = false;

    if (data.type === UserType.ONG) {
      const verificacao = await this.cnpjVerificationService.consultarCnpj(
        data.cnpj,
        data.name,
      );

      medalhaVerde = verificacao.verificacao.medalhaVerde;
    }

    const user = this.repo.create({
      ...data,
      password: hashedPassword,

      status: UserStatus.ATIVO,

      medalhaVerde,
    });

    const savedUser = (await this.repo.save(user)) as unknown as User;

    const { password, ...result } = savedUser;

    return result;
  }

  async login(email: string, password: string) {
    const users = await this.repo.find({
      where: { email },
      take: 1,
    });

    const user = users[0] as unknown as User;

    if (!user) {
      throw new HttpException(
        'Email ou senha inválidos',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new HttpException(
        'Email ou senha inválidos',
        HttpStatus.UNAUTHORIZED,
      );
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

  async findAllOngs() {
    const ongs = await this.repo.find({
      where: {
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
        'createdAt',
        'averageRating',
        'totalReviews',
        'status',
        'averageRating',
        'medalhaVerde',
      ],
    });

    return ongs;
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

  async updateProfile(id: number, data: any) {
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

    Object.assign(user, data);

    const updatedUser = await this.repo.save(user);

    const { password, ...result } = updatedUser;

    return result;
  }

  async updateOng(
    id: number,
    data: any,
    requestingUserId: number,
  ) {
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
      throw new ForbiddenException(
        'Você só pode editar o próprio perfil',
      );
    }

    Object.assign(ong, data);

    const updatedOng = await this.repo.save(ong);

    const { password, ...result } = updatedOng;

    return result;
  }

  

}

