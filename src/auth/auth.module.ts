import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';


import { getJwtExpiresIn, getJwtSecret } from './jwt.config';
import { JwtStrategy } from './jwt.strategy';
import { OngGuard } from './ong.guard';

@Module({
  imports: [
    PassportModule,
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
  providers: [JwtStrategy, OngGuard],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}