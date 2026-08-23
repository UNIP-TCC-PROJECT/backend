import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { getJwtSecret } from './jwt.config';
import type { JwtPayload } from './jwt-payload.interface';
import { User } from '../users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(config),
    });
  }

  async validate(payload: JwtPayload) {
    console.log('🔍 Payload recebido:', payload);
    
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      console.log('❌ Usuário não encontrado:', payload.sub);
      return null;
    }

    console.log('✅ Usuário encontrado:', user.id, user.email, user.type);

    const { password, ...result } = user;
    return result;
  }
}