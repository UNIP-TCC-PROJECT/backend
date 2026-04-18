import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private repo: Repository<User>,
  ) {}

  async create(data: any) {
    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = this.repo.create({
      ...data,
      password: hashedPassword,
    });

    return this.repo.save(user);
  }

  async login(email: string, password: string) {
  const user = await this.repo.findOne({ where: { email } });

  if (!user) {
    throw new Error('Usuário não encontrado');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new Error('Senha inválida');
  }

  return {
    id: user.id,
    type: user.type,
  };
}
}