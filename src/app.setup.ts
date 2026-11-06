import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';

const LOCAL_DEV = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Origens permitidas no CORS. Nunca reflete origens arbitrárias:
 *  - CORS_ORIGINS definido → somente a lista;
 *  - produção sem lista → nenhuma origem externa;
 *  - desenvolvimento → apenas localhost.
 */
export function corsOrigin(env: NodeJS.ProcessEnv = process.env) {
  const list = env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return cb(null, true); // não é requisição de navegador (curl, servidor a servidor)
    if (list.length) return cb(null, list.includes(origin));
    cb(null, env.NODE_ENV !== 'production' && LOCAL_DEV.test(origin));
  };
}

// A API só devolve JSON/arquivos: nada de HTML/scripts, nem incorporação em frames.
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** Configuração HTTP compartilhada por main.ts e pelos testes de segurança (o que é testado é o que roda). */
export function configureApp(app: NestExpressApplication) {
  app.disable('x-powered-by');
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', API_CSP);
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    index: false,
    dotfiles: 'deny',
    setHeaders(response) {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    },
  });

  app.enableCors({
    origin: corsOrigin(),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization, Idempotency-Key',
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
}
