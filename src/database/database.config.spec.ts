import { dbOptions } from './database.config';

const full = { DB_NAME: 'x', DB_USER: 'app', DB_PASSWORD: 'p-app', DB_MIGRATOR_USER: 'mig', DB_MIGRATOR_PASSWORD: 'p-mig' };

describe('dbOptions', () => {
  it('não tem credenciais padrão: sem DB_USER/DB_PASSWORD a aplicação não sobe', () => {
    expect(() => dbOptions('runtime', { DB_NAME: 'x' })).toThrow(/DB_USER/);
    expect(() => dbOptions('runtime', { DB_NAME: 'x', DB_USER: 'app' })).toThrow(/DB_PASSWORD/);
    expect(() => dbOptions('migrator', { DB_NAME: 'x' })).toThrow(/DB_MIGRATOR_USER/);
    expect(() => dbOptions('runtime', { DB_USER: 'app', DB_PASSWORD: 'p' })).toThrow(/DB_NAME/);
  });
  it('nunca usa synchronize e não confunde os papéis', () => {
    const rt = dbOptions('runtime', full), mg = dbOptions('migrator', full);
    expect(rt.synchronize).toBe(false);
    expect(mg.synchronize).toBe(false);
    expect(rt.username).toBe('app');
    expect(mg.username).toBe('mig');
    expect(rt.password).toBe('p-app');
  });
  it('o runtime não precisa (nem recebe) as credenciais do migrator', () => {
    expect(() => dbOptions('runtime', { DB_NAME: 'x', DB_USER: 'app', DB_PASSWORD: 'p' })).not.toThrow();
  });
});
