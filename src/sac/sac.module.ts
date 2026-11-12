import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { ConversaSac } from './entities/conversa-sac.entity';
import { MensagemSac } from './entities/mensagem-sac.entity';
import { SacController } from './sac.controller';
import { SacService } from './sac.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([User, ConversaSac, MensagemSac]),
  ],
  controllers: [SacController],
  providers: [SacService],
})
export class SacModule {}
