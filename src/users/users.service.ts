import { Injectable, HttpException, HttpStatus, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';
import bcrypt from 'bcrypt';

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
}