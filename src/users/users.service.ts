import {
  Injectable,
  HttpException,
  HttpStatus,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { User, UserType } from './entities/user.entity';
import type { JwtPayload } from '../auth/jwt-payload.interface';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private repo: Repository<User>,
    private jwtService: JwtService,
  ) {}

  async create(data: any) {
    const existingUser = await this.repo.findOne({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('Email já cadastrado');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = this.repo.create({
      ...data,
      password: hashedPassword,
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
      throw new HttpException('Email ou senha inválidos', HttpStatus.UNAUTHORIZED);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new HttpException('Email ou senha inválidos', HttpStatus.UNAUTHORIZED);
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return { access_token: accessToken };
  }

  async findById(id: number) {
    const user = await this.repo.findOne({ where: { id } });

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
      ],
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada');
    }

    return ong;
  }

  async updateProfile(id: number, data: any) {
    const user = await this.repo.findOne({ where: { id } });

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

  async updateOng(id: number, data: any) {
    const ong = await this.repo.findOne({
      where: {
        id,
        type: UserType.ONG,
      },
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada');
    }

    Object.assign(ong, data);

    const updatedOng = await this.repo.save(ong);

    const { password, ...result } = updatedOng;

    return result;
  }
}