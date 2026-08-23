import {
  Injectable,
  HttpException,
  HttpStatus,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import bcrypt from 'bcrypt';
import { User, UserType } from './entities/user.entity';



@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private repo: Repository<User>,
  ) {}

  async create(data: any) {
    const existingUser = await this.repo.findOne({ 
      where: { email: data.email } 
    });
    
    if (existingUser) {
      throw new ConflictException('Email já cadastrado');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = this.repo.create({
      ...data,
      password: hashedPassword,
    });

    const savedUser = await this.repo.save(user) as unknown as User;
    
    const { password, ...result } = savedUser;
    return result;
  }
  
  async login(email: string, password: string) {
    const users = await this.repo.find({ 
      where: { email },
      take: 1
    });
    
    const user = users[0] as unknown as User;

    if (!user) {
      throw new HttpException('Email ou senha inválidos', HttpStatus.UNAUTHORIZED);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new HttpException('Email ou senha inválidos', HttpStatus.UNAUTHORIZED);
    }

    const { password: _, ...result } = user;
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
    ],
  });

  if (!ong) {
    throw new NotFoundException('ONG não encontrada');
  }

  return ong;
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