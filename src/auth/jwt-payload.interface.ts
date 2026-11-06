import { UserType, UserStatus } from '../users/entities/user.entity';

export interface JwtPayload {
  sub: number;
  email: string;
  type: UserType;
  status: UserStatus;
  sid: string;
}