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
import { User, UserType } from './entities/user.entity';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { CreateAdminDto } from '../admin/dto/create-admin-dto';

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

  async findAllUsers() {
    const users = await this.repo.find();
    return users.map(({ password, ...rest }) => rest);
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

  async updateOng(id: number, data: any, requesterId: number) {
    const ong = await this.repo.findOne({
      where: {
        id,
        type: UserType.ONG,
      },
    });

    if (!ong) {
      throw new NotFoundException('ONG não encontrada');
    }

    if (ong.id !== requesterId) {
      throw new ForbiddenException('Você só pode editar o seu próprio perfil.');
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
  });

  const savedAdmin = await this.repo.save(admin);

  const { password, ...result } = savedAdmin;
  return result;
}
}