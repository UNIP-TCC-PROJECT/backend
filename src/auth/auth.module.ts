
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { getJwtExpiresIn, getJwtSecret } from './jwt.config';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { OngGuard } from './ong.guard';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: getJwtSecret(config),
        signOptions: {
          expiresIn: getJwtExpiresIn(config),
        },
      }),
    }),
  ],
  providers: [JwtStrategy, RolesGuard, OngGuard],
  exports: [JwtModule, PassportModule, RolesGuard, OngGuard],
})
export class AuthModule {}
