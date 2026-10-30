import type { AuditActor } from '../audit/audit.service';

export interface RequestUser extends AuditActor {
  id: number;
  type: string;
}

export const actorOf = (req: any): RequestUser => ({
  id: req.user.id,
  type: req.user.type,
});
