import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Interesse } from '../interesses/entities/interesse.entity';
import { User } from '../users/entities/user.entity';
import { Conversa } from './entities/conversa.entity';
import { Mensagem } from './entities/mensagem.entity';
import { ConversasController } from './conversas.controller';
import { ConversasService } from './conversas.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversa, Mensagem, Interesse, User]),
    AuthModule,
  ],
  controllers: [ConversasController],
  providers: [ConversasService],
})
export class ConversasModule {}
