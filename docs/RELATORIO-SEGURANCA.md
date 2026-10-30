# Relatório de revisão de segurança e qualidade

Plataforma de transparência para ONGs — backend NestJS/PostgreSQL + frontend React.
Referências: OWASP Top 10 (2021) e OWASP ASVS 4.0.3. Data da revisão: 2026-10-30.

> **Este relatório não afirma que a plataforma é "100% segura".** Ele mostra o que foi atacado, o que falhou, o que foi
> corrigido e o que ainda é risco. Ausência de falha nos testes não prova ausência de vulnerabilidades.

## 1. Resumo

| Item | Resultado |
|---|---|
| Suíte de ataque (nova, `test/seguranca.e2e-spec.ts`) | **60/60** testes passando após as correções |
| Mesma suíte **antes** das correções | **20 de 59 falhavam** (após descartar defeitos do próprio teste) |
| Testes de integração do produto (`test/plataforma.e2e-spec.ts` + Medalha Branca) | 81/81 |
| Testes unitários | 79/79 |
| Vulnerabilidades reais encontradas | **12** (3 altas, 7 médias, 2 baixas) + dependências |
| Corrigidas | **12 de 12** + redução das dependências (ver §3 e §5) |
| Riscos remanescentes relevantes | 18 (ver §5), incluindo 1 decisão de produto em aberto |

Como foi feito: aplicação real (Nest + PostgreSQL, schema temporário descartável), com a **mesma** configuração HTTP de produção
(`src/app.setup.ts`). Asaas, BrasilAPI, Portal da Transparência etc. são **simulados** (sem rede e sem chaves reais).
**Nenhum dado real** foi usado: e-mails `@example.invalid`, CPF de teste matematicamente válido sem titular, CNPJs gerados.
Primeiro rodei os ataques, depois corrigi, depois rodei de novo; as duas execuções estão salvas em `docs/evidencias/`.

## 2. Vulnerabilidades encontradas e correções

Gravidade pela minha avaliação de impacto neste contexto (financeiro + dados de ONGs), não por CVSS formal.

| # | Gravidade | Teste | Problema encontrado | Correção aplicada |
|---|---|---|---|---|
| V-01 | **Alta** | FIN-09 | **Condição de corrida na aprovação de despesas.** Quatro aprovações simultâneas aprovaram **R$ 240** de despesas em campanha com **R$ 100** de saldo: o limite era verificado e gravado sem trava. | Aprovação passou a rodar em transação que trava a campanha (`FOR UPDATE`), relê a despesa e recalcula o saldo dentro da transação. Teste repete o ataque. |
| V-02 | **Alta** | AUTZ-10 | **Conta suspensa/banida mantinha acesso** por até 8 h (token ainda válido): doador suspenso continuava doando. Só `OngGuard` checava o status. | `JwtAuthGuard` rejeita (403) qualquer usuário não `ATIVO`, em todas as rotas autenticadas e para todos os perfis. |
| V-03 | **Alta** | FILE-10 | **Upload de avatar (código legado) confiava no cliente:** MIME informado e extensão do nome original. Arquivo `.html`/`.svg` ficava em `/uploads` e era servido como HTML (XSS armazenado na origem da API). | Conteúdo validado pelos bytes (JPG/PNG/WebP), extensão definida pelo servidor, arquivo em memória→disco; `/uploads` servido com `CSP: default-src 'none'; sandbox` e `nosniff`. |
| V-04 | Média | AUTZ-12 | ONG podia **trocar o CNPJ** após a verificação e manter a medalha verde obtida com o CNPJ anterior (legado). | Alteração de CNPJ recusada (400); exige a administração. |
| V-05 | Média | APP-03 | **CORS refletia qualquer origem** com `credentials: true` quando `CORS_ORIGINS` não estava definido. | Allowlist estrita: sem lista, produção não libera origem externa e desenvolvimento só `localhost`. **Achado adicional:** o cabeçalho `Idempotency-Key` (usado pelo frontend nas doações) não estava liberado no CORS — a doação falharia no navegador; corrigido. |
| V-06 | Média | INT-01 | Resposta da BrasilAPI **de outro CNPJ** era aceita como consulta válida. | A resposta precisa ter o mesmo CNPJ consultado; caso contrário a consulta fica `INDISPONIVEL`. |
| V-07 | Média | INT-04, INT-07 | Resposta malformada do Asaas (HTML/sem `id`) **criava doação "pendente" sem cobrança**, retornando 201. | Respostas do Asaas são validadas (formato de `cus_`/`pay_`, status, valor, payload Pix); fora do esperado → 502 e doação cancelada. |
| V-08 | Média | INT-06 | Webhook de **pagamento desconhecido** consultava o Asaas e devolvia 5xx; o Asaas reenviaria sem fim e pode pausar a fila. | Pagamento que não é nosso é ignorado (200) **antes** de qualquer chamada ao provedor. |
| V-09 | Média | APP-09 | Cadastro aceitava senhas de **6 caracteres** (`123456`, `abc123`). | Mínimo 8, máximo 72 (limite do bcrypt), bloqueio de senhas comuns/repetitivas, em cadastro, reset e criação de admin; frontend alinhado. |
| V-10 | Média | APP-10 | **Cadastro sem limite de tentativas** (spam, enumeração em massa). | Limite de 10 cadastros/min por IP (429). |
| V-11 | Baixa | APP-02 | API sem `Content-Security-Policy`. | `default-src 'none'; frame-ancestors 'none'` em todas as respostas. |
| V-12 | Baixa | APP-07 | Respostas de usuário vazavam campos internos (`asaasCustomerId`, `failedLoginAttempts`, `lockedUntil`). | `sanitizeUser` remove senha, segredo MFA e campos internos em todas as respostas de usuário. |

Melhorias adicionais (não eram falhas): **cadeia de hash na auditoria** com rota `GET /admin/audit-logs/verify` (§4) e inventário
automático de rotas (AUTZ-05) que falha se surgir rota sem guard fora de uma lista pública explícita.

Defeitos do **próprio teste** corrigidos durante a revisão (não são do produto): um teste revogava a sessão do doador compartilhado
(cascata de 401), CNPJs de teste repetidos/inválidos, espera fixa de 300 ms em teste assíncrono e uma contagem de auditoria que
ignorava que a auditoria só cresce. Registro para transparência.

## 3. Cobertura pedida × resultado

**Autorização:** doador/ONG/admin sem MFA/anônimo contra 25 rotas administrativas (AUTZ-01..04); ONG × ONG em despesas,
comprovantes, documentos, campanhas, entregas, metas, perfil e conversas (AUTZ-06, 11); ONG não aprovada em 5 estados não publica
campanha, despesa nem recebe doação (AUTZ-07); ONG não aprova os próprios documentos, nem a si mesma, nem por *mass assignment*
(AUTZ-08, 09); usuário não escreve na auditoria (AUD-02, 03).
**Financeiro:** FIN-01..09 (valor de doação confirmada imutável, webhook falso/repetido/simultâneo, divergência de valor/referência/cartão/dinheiro,
soma exata do arrecadado em 5 visões, despesa não aprovada fora dos totais, corrida).
**Arquivos:** FILE-01..11 (HTML/EXE/SVG/PHP/ZIP disfarçados, MIME×bytes, limites 413, nomes com `../` e CRLF, acesso a privados, histórico
de substituição, falha de armazenamento sem vazamento, `/uploads`).
**Aplicação:** SQLi (6 payloads × 8 rotas + corpo + login), XSS armazenado + varredura de *sinks* no frontend (nenhum
`dangerouslySetInnerHTML`/`innerHTML`/`eval`), CSRF/CORS, bloqueio de conta e 429, enumeração, sessões (expirada, revogada, *alg none*, assinatura
errada, `sid` alheio, tipo forjado no token), reset de senha, exposição de dados, validação.
**Integrações:** BrasilAPI (fora, timeout, HTML, outro CNPJ), Portal (fora, sem chave, lixo), todas fora ao mesmo tempo, Asaas (fora, timeout, lixo, sem chave,
sem `id`), webhooks inválidos, falha de armazenamento. **Nenhuma indisponibilidade gerou aprovação de ONG ou confirmação de doação.**
Aprovação com fontes fora só ocorre por decisão humana de admin com justificativa registrada na auditoria (INT-03).

## 4. Auditoria e a cadeia de hash

- Registro das ações críticas com responsável, entidade, organização, IP e data (AUD-01); logs sem segredos (AUD-05).
- Imutabilidade por gatilho no banco: `UPDATE`/`DELETE`/`TRUNCATE` falham (AUD-03); sem rota HTTP de escrita (AUD-02).
- **Cadeia de hash:** cada registro guarda `hash = SHA-256(hash anterior + conteúdo canônico)`; gravação serializada por lock.
  `GET /admin/audit-logs/verify` percorre a cadeia. Em AUD-04 simulei um atacante com acesso direto ao banco (desliguei o gatilho):
  **editar** uma linha e **apagar** uma do meio são detectados (`firstBadId`).
- **Limitações (importantes):**
  1. **Não detecta remoção das últimas linhas** (nem das primeiras): a cadeia restante continua consistente — o teste AUD-04 documenta isso.
     Mitigação: ancorar periodicamente o `headHash` fora do banco (e-mail, serviço externo, armazenamento WORM).
  2. Um atacante que **recalcule a cadeia inteira** (tem o algoritmo e acesso de escrita) não é detectado sem âncora externa.
  3. Hash **detecta alteração posterior; não prova que o conteúdo original era verdadeiro** — um registro falso gravado corretamente continua falso.
  4. O gatilho de imutabilidade pode ser desligado por um superusuário do banco (foi o que o teste fez). Hoje a aplicação conecta como `postgres`.
  5. Registros anteriores à cadeia ficam sem hash e fora da verificação.

## 5. Riscos que ainda precisam de atenção

| # | Gravidade | Risco | Recomendação |
|---|---|---|---|
| R-01 | **Média — decisão de produto** | Página pública da ONG (legado) expõe **e-mail de login, telefone, WhatsApp e chave Pix** (`docs/evidencias/exposicao-publica-ongs.json`). O e-mail é identificador de login (spam/credential stuffing); a chave Pix incentiva doação **fora da plataforma**, sem registro nem transparência. **Não alterei:** o frontend usa esses campos de propósito. | Decidir: e-mail de contato separado do e-mail de login; remover/ocultar Pix público ou apontar para doação pela plataforma. |
| R-02 | Média | **Dependências:** backend ainda com 2 *high* (`@nestjs/platform-express`/`multer`, DoS), que exigem salto de versão maior; frontend com 1 *high* (`follow-redirects`, indireta, só afeta uso em Node). Reduzi de 1 crítica+5 altas+2 médias (backend) e 5 altas (frontend). `yarn.lock` ficou desatualizado em relação ao `package-lock.json`. | Planejar upgrade maior do NestJS/multer com testes; padronizar o gerenciador (yarn ou npm); rodar `npm audit` no CI. |
| R-03 | Média | Token e usuário ficam no **`localStorage`**: qualquer XSS futuro rouba a sessão (8 h). Hoje não há *sinks* conhecidos. | Cookie `httpOnly`+`SameSite` com proteção CSRF, ou tokens curtos com refresh rotativo. |
| R-04 | Média | Aplicação usa o superusuário `postgres` com senha padrão (`docker-compose.yml`); gatilho da auditoria pode ser desligado; um comprometimento da aplicação = controle total do banco. | Papéis separados (migração × aplicação sem `ALTER`/`TRIGGER`; `INSERT`/`SELECT` apenas em `audit_logs`), segredos fora do repositório, senha forte. |
| R-05 | Média | `synchronize: true` (sem migrations): mudança de entidade altera o banco em produção sem revisão. | Migrations versionadas; desligar `synchronize`. |
| R-06 | Média | Arquivos em `bytea` no Postgres, **sem antivírus**; PDFs não têm metadados/JS removidos (só JPG/PNG sanitizados). | Armazenamento privado (Supabase/S3) com URLs assinadas e varredura (ClamAV); PDFs só públicos com atesto do admin (já é regra). |
| R-07 | Média | Proteção de beneficiários em evidências depende de **revisão humana** (rostos, documentos nas fotos); texto livre só tem máscara de CPF/e-mail/telefone por regex. | Treinar/checklist do analista; considerar borrar rostos; dupla aprovação para publicação. |
| R-08 | Média | Limite de requisições **em memória e por IP**: com vários processos não é compartilhado; atrás de proxy sem `trust proxy` todos compartilham o IP (429 em massa) ou o limite é contornável. `sync` do doador consulta o Asaas sem limite próprio. | Armazenamento compartilhado (Redis), `trust proxy` correto, limites por rota/usuário. |
| R-09 | Média | Legado: `PATCH /users/me` troca **e-mail sem reautenticação**; `profileImage` aceita string arbitrária; rota de depuração `GET /users/admin-test`; `metas` aceita `currentAmount` informado pela ONG (progresso autodeclarado, fora do livro-caixa verificável). | Exigir senha para trocar e-mail; validar `profileImage`; remover `admin-test`; rotular/migrar metas para campanhas. |
| R-10 | Média | Cadastro responde "e-mail já cadastrado" (**enumeração**), embora limitado a 10/min por IP. Sem verificação de e-mail no cadastro. | Resposta neutra + confirmação por e-mail. |
| R-11 | Média | **Estorno/chargeback após despesa aprovada** pode deixar o saldo negativo; o sistema calcula e mostra, mas não impede. | Política de reconciliação e alerta ao admin. |
| R-12 | Média | MFA só para administradores, **sem códigos de recuperação** (risco de bloqueio) e sem MFA para ONGs. | Códigos de recuperação; MFA opcional/obrigatório para ONGs. |
| R-13 | Baixa | Webhook autenticado por **token estático** (sem lista de IPs do Asaas, sem rotação programada). | Rotação periódica; lista de IPs se o provedor oferecer; alerta em falhas de autenticação. |
| R-14 | Baixa | Senhas: ASVS 4.0 recomenda ≥12; adotei 8 (compatível com a recomendação atual do NIST/ASVS 5) com bloqueio de senhas comuns, sem checagem contra vazamentos (HIBP). | Subir para 12 ou integrar lista de senhas vazadas. |
| R-15 | Baixa | Pasta `backend/recuperacao-git-*` (objetos Git antigos) dentro do projeto; pode conter segredos históricos. `.env` está no `.gitignore`. | Remover do repositório/entrega; rotacionar `JWT_SECRET` e chaves se algum dia foram versionados. |
| R-16 | Baixa | Sem registro de tentativas de webhook com token inválido na auditoria (só *log* de aplicação) para evitar inundação. | Contador/alerta em vez de registro por tentativa. |
| R-17 | Baixa | TLS, HSTS e cabeçalhos do proxy dependem da implantação (não testados aqui). | Validar em ambiente de homologação (testssl/SecurityHeaders). |
| R-18 | Informativo | **Não testado:** integração real com Asaas sandbox (sem chave), navegador/UI ponta a ponta, carga/DoS, e-mail, mobile, pentest manual/DAST/SAST de terceiros, infraestrutura. Mapa das OSCs tem rota documentada que respondeu 404. | Rodar o roteiro no sandbox do Asaas; DAST (ZAP) em homologação; pentest independente antes de produção. |

## 6. Mapeamento OWASP

| OWASP Top 10 (2021) | Controles / testes | Situação |
|---|---|---|
| A01 Controle de acesso | RBAC por rota, isolamento por organização (404), inventário automático de rotas, conta ativa em toda rota, MFA admin (AUTZ-*, FILE-06) | Atendido; ver R-09 |
| A02 Falhas criptográficas | bcrypt (custo 12), JWT HS256 com segredo de 64 caracteres, MFA cifrado AES-256-GCM, comparação em tempo constante no webhook; sem TLS testado | Parcial (R-03, R-17) |
| A03 Injeção | Consultas parametrizadas (TypeORM), validação com *whitelist*, APP-01/02, FILE-01..05 | Atendido nos testes |
| A04 Design inseguro | Nada nasce aprovado; confirmação de pagamento só via consulta ao provedor; limites de saldo; falha fechada em integrações | Atendido; ver R-11 |
| A05 Configuração insegura | CORS restrito, CSP, cabeçalhos, sem `x-powered-by`; `synchronize`, credenciais padrão do Docker | Parcial (R-04, R-05) |
| A06 Componentes vulneráveis | `npm audit` antes/depois salvo em evidências | Parcial (R-02) |
| A07 Falhas de autenticação | Bloqueio de conta, 429 por IP, sessões revogáveis/expiráveis, reset de uso único, senha forte | Atendido; ver R-10, R-12, R-14 |
| A08 Integridade de software/dados | Hash dos arquivos, cadeia de hash da auditoria, idempotência de eventos | Parcial (seção 4) |
| A09 Falhas de registro/monitoramento | Auditoria imutável + verificação; **sem alertas/monitoramento ativos** | Parcial |
| A10 SSRF | Hosts externos fixos; `cnpj`/ids sanitizados e codificados | Atendido nos testes |

ASVS 4.0.3 (referência, **não** é certificação): V2 (autenticação), V3 (sessões), V4 (acesso), V5 (validação), V7 (erros/logs), V12 (arquivos), V13 (API) e
V14 (configuração) foram exercitados nos testes acima. V6 (criptografia em repouso/em trânsito), V8 (proteção de dados em repouso) e V9 (comunicação)
só foram revisados em código, não testados em ambiente.

## 7. Recomendações finais (ordem sugerida)

1. Decidir R-01 (contatos/Pix públicos) e implementar.
2. Papéis de banco separados, segredos novos, remover `recuperacao-git-*` e credenciais padrão (R-04, R-15).
3. Migrations e desligar `synchronize` (R-05).
4. Armazenamento privado com varredura de malware e URLs assinadas (R-06).
5. Migrar sessão para cookie `httpOnly` com CSRF (R-03) e rate limit compartilhado (R-08).
6. Upgrade planejado do NestJS/multer e rotina de `npm audit` no CI (R-02).
7. Âncora externa periódica do `headHash` da auditoria e alerta de `verify` falho.
8. Testar contra o **sandbox real do Asaas**, rodar DAST (OWASP ZAP) em homologação e contratar pentest antes de receber dinheiro real.

## 8. Evidências (`backend/docs/evidencias/`)

| Arquivo | Conteúdo |
|---|---|
| `antes-das-correcoes.json` | Execução da suíte **antes** das correções (20 falhas = vulnerabilidades/lacunas) |
| `depois-das-correcoes.json`, `resultado-jest-seguranca.json` | Execução depois (60/60) |
| `resultado-jest-plataforma.json`, `resultado-unitarios.json` | Testes de integração do produto (81) e unitários (79) |
| `rotas.json` | Inventário de todas as rotas com guards/roles; rotas públicas e verificação de `@Roles` sem `RolesGuard` |
| `npm-audit-*.json`, `npm-audit-*-depois.json` | Auditoria de dependências antes/depois |
| `frontend-sinks.txt` | Varredura por `dangerouslySetInnerHTML`/`innerHTML`/`eval` (vazio = nenhum) |
| `exposicao-publica-ongs.json` | Campos hoje expostos na página pública da ONG (R-01) |

Reproduzir (com o Postgres do `docker compose up -d postgres-db`):

```
node node_modules/jest/bin/jest.js --config test/jest-seguranca.json --runInBand
node node_modules/jest/bin/jest.js --config test/jest-plataforma.json --runInBand
node node_modules/jest/bin/jest.js
```

## Apêndice — resultado de cada teste (gerado dos JSONs de execução)

**1. Autorização**

| Teste | Antes das correções | Depois |
|---|---|---|
| AUTZ-01 doador não acessa nenhuma função administrativa | ❌ falhou | ✅ passou |
| AUTZ-02 ONG não acessa nenhuma função administrativa | ❌ falhou | ✅ passou |
| AUTZ-03 administrador sem MFA verificado também é barrado | ❌ falhou | ✅ passou |
| AUTZ-04 anônimo recebe 401 nas rotas administrativas | ❌ falhou | ✅ passou |
| AUTZ-05 inventário de rotas: toda rota é pública (allowlist explícita) ou exige JwtAuthGuard; todo @Roles tem RolesGuard | ✅ | ✅ passou |
| AUTZ-06 ONG não acessa dados de outra ONG (recursos novos) | ✅ | ✅ passou |
| AUTZ-07 ONG não aprovada (qualquer estado) não publica campanha, não registra despesa e não recebe doação | ✅ | ✅ passou |
| AUTZ-08 ONG não aprova os próprios documentos nem a si mesma | ✅ | ✅ passou |
| AUTZ-09 cadastro e perfil: sem escalonamento de privilégio nem mass assignment | ✅ | ✅ passou |
| AUTZ-10 conta suspensa/banida perde o acesso imediatamente (qualquer perfil), mesmo com token ainda válido | ❌ falhou | ✅ passou |
| AUTZ-11 recursos legados: ONG não edita meta nem perfil de outra ONG; terceiros não leem conversas alheias | ✅ | ✅ passou |
| AUTZ-12 ONG não troca o próprio CNPJ após a verificação (mantém medalha só para o CNPJ verificado) | ❌ falhou | ✅ passou |

**2. Financeiro**

| Teste | Antes das correções | Depois |
|---|---|---|
| FIN-01 doação confirmada não pode ter o valor/estado alterados por usuário | ✅ | ✅ passou |
| FIN-02 criação ignora campos de controle e rejeita valores inválidos | ✅ | ✅ passou |
| FIN-03 webhook falso: sem token, token errado, vazio, de outro tamanho ou sem configuração → rejeitado e nada muda | ✅ | ✅ passou |
| FIN-04 notificação autêntica, mas o Asaas diz PENDING (ou o corpo afirma "RECEIVED") → não confirma | ✅ | ✅ passou |
| FIN-05 cobrança divergente (valor, referência, cartão, baixa manual em dinheiro) nunca confirma | ✅ | ✅ passou |
| FIN-06 webhook repetido (mesmo id e ids novos) e simultâneo não duplica a doação nem o valor | ✅ | ✅ passou |
| FIN-07 valor arrecadado = soma exata das confirmadas (pendente/cancelada/estornada não contam) em todas as visões | ✅ | ✅ passou |
| FIN-08 despesa não aprovada (enviada/em análise/complementação/reprovada) nunca aparece como aprovada nem entra nos totais públicos | ✅ | ✅ passou |
| FIN-09 aprovações simultâneas não ultrapassam o saldo arrecadado (condição de corrida) | ❌ falhou | ✅ passou |

**3. Arquivos**

| Teste | Antes das correções | Depois |
|---|---|---|
| FILE-01 conteúdo malicioso com extensão e MIME de documento é recusado (HTML/EXE/SVG/script/ZIP/PHP) | ✅ | ✅ passou |
| FILE-02 extensão/MIME falsos: bytes de PNG declarados como PDF (e vice-versa) são recusados; nome com extensão perigosa é só rótulo | ✅ | ✅ passou |
| FILE-03 acima do limite → 413 (documentos, comprovantes, evidências, imagem de campanha, avatar) | ✅ | ✅ passou |
| FILE-04 vazio, campo inesperado, vários arquivos ou sem arquivo → 400 (nunca 500) | ✅ | ✅ passou |
| FILE-05 nomes de arquivo maliciosos não permitem path traversal nem injeção de cabeçalho | ✅ | ✅ passou |
| FILE-06 documentos privados: anônimo, doador, outra ONG e rotas públicas não acessam | ✅ | ✅ passou |
| FILE-07 cabeçalhos dos downloads: nosniff, attachment, tipo correto e sem cache compartilhado em arquivos privados | ✅ | ✅ passou |
| FILE-08 substituição sem histórico: documento institucional substituído mantém a versão anterior; comprovante aprovado não pode ser trocado/anexado/apagado | ✅ | ✅ passou |
| FILE-09 falha no armazenamento: erro genérico (500), sem vazamento e sem registro órfão | ✅ | ✅ passou |
| FILE-10 avatar legado: conteúdo/extensão forjados são recusados e o que fica salvo é inofensivo | ❌ falhou | ✅ passou |
| FILE-11 pasta /uploads: sem path traversal, sem dotfiles e sem listagem | ✅ | ✅ passou |

**4. Aplicação**

| Teste | Antes das correções | Depois |
|---|---|---|
| APP-04 tentativas excessivas de login: bloqueio da conta (5) e limite por IP (429) e sem enumeração de usuários | ✅ | ✅ passou |
| APP-01 SQL injection: payloads em query, rota, corpo e login não geram 500, não vazam dados e não alteram tabelas | ✅ | ✅ passou |
| APP-02 XSS: scripts armazenados voltam como texto inerte (JSON, nosniff, sem HTML) e o frontend não usa sinks perigosos | ❌ falhou | ✅ passou |
| APP-03 CSRF: autenticação é por header Authorization (cookie sozinho não autentica) e CORS só libera origens permitidas | ❌ falhou | ✅ passou |
| APP-05 sessões: expirada, revogada, logout, logout-all, token sem sid, "alg none", assinatura errada e sid de outro usuário → 401 | ✅ | ✅ passou |
| APP-06 recuperação de senha: link de uso único, expira sessões, resposta idêntica para e-mail inexistente | ❌ falhou | ✅ passou |
| APP-07 exposição de informação: sem hash de senha/segredos, erros genéricos e cabeçalhos de segurança | ❌ falhou | ✅ passou |
| APP-11 [RISCO EM ABERTO] contatos públicos da página da ONG (e-mail de login, telefone, WhatsApp, chave Pix) — documentado, depende de decisão de produto | ✅ | ✅ passou |
| APP-08 validação no servidor: JSON malformado, tipos errados, UUID inválido, corpo gigante e campos desconhecidos | ✅ | ✅ passou |
| APP-09 senha forte: cadastro rejeita senhas curtas/comuns | ❌ falhou | ✅ passou |
| APP-10 cadastro e recuperação com limite de tentativas (429) e sem enumeração por cadastro | ❌ falhou | ✅ passou |

**5. Integrações**

| Teste | Antes das correções | Depois |
|---|---|---|
| INT-01 BrasilAPI down: ONG fica EM_ANALISE (nunca aprovada sozinha) e a aprovação exige justificativa | ✅ | ✅ passou |
| INT-01 BrasilAPI timeout: ONG fica EM_ANALISE (nunca aprovada sozinha) e a aprovação exige justificativa | ✅ | ✅ passou |
| INT-01 BrasilAPI html: ONG fica EM_ANALISE (nunca aprovada sozinha) e a aprovação exige justificativa | ✅ | ✅ passou |
| INT-01 BrasilAPI outroCnpj: ONG fica EM_ANALISE (nunca aprovada sozinha) e a aprovação exige justificativa | ❌ falhou | ✅ passou |
| INT-02 Portal da Transparência down: consulta INDISPONIVEL, ONG pendente e aprovação bloqueada | ✅ | ✅ passou |
| INT-02 Portal da Transparência nokey: consulta INDISPONIVEL, ONG pendente e aprovação bloqueada | ✅ | ✅ passou |
| INT-02 Portal da Transparência garbage: consulta INDISPONIVEL, ONG pendente e aprovação bloqueada | ✅ | ✅ passou |
| INT-03 todas as fontes fora do ar: o envio funciona, tudo INDISPONIVEL, nenhuma aprovação automática; override só por admin e com justificativa registrada | ✅ | ✅ passou |
| INT-04 Asaas indisponível/timeout/lixo/sem chave na criação: erro controlado, doação não fica pendente, nada confirmado | ❌ falhou | ✅ passou |
| INT-05 Asaas fora ao confirmar: webhook devolve 5xx (para reenvio) e NÃO confirma; ao voltar, reentrega confirma uma vez | ✅ | ✅ passou |
| INT-06 webhooks inválidos com token correto (vazio, sem id, tipos errados, evento de outro recurso, pagamento desconhecido) não geram 5xx nem efeitos | ❌ falhou | ✅ passou |
| INT-07 resposta do Asaas sem id/estrutura esperada não cria cobrança "fantasma" | ❌ falhou | ✅ passou |

**6. Auditoria**

| Teste | Antes das correções | Depois |
|---|---|---|
| AUD-01 ações críticas estão registradas com responsável, entidade, organização e data | ✅ | ✅ passou |
| AUD-02 usuários não leem nem escrevem logs: sem rotas de escrita; leitura só admin com MFA | ❌ falhou | ✅ passou |
| AUD-03 imutabilidade no banco: UPDATE, DELETE e TRUNCATE são rejeitados (inclusive SQL direto da aplicação) | ✅ | ✅ passou |
| AUD-04 cadeia de hash: verificação íntegra; detecta edição e remoção no meio; NÃO detecta truncamento do final (limitação documentada) | ❌ falhou | ✅ passou |
| AUD-05 logs e eventos não guardam segredos (senhas, hashes, tokens, chaves, CPF) | ✅ | ✅ passou |
