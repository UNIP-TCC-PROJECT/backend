import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { getJwtSecret } from './jwt.config';
import type { JwtPayload } from './jwt-payload.interface';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(config),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    // Status (suspensa/banida) segue sendo tratado pelos guards, como antes; aqui exige-se sessão válida.
    if (!user || !payload.sid) {
      return null;
    }

    const session = await this.authService.findActiveSession(payload.sid, user.id);
    if (!session) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      type: user.type,
      status: user.status,
      sid: session.id,
      mfaVerified: session.mfaVerified,
    };
  }
}