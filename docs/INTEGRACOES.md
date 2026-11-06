# Integrações externas

Atualizado em 30/10/2026. Homologação real: `node scripts/homologar-integracoes.js [CNPJ]`
(chama as APIs de verdade; sem credencial o resultado é "PENDENTE DE CREDENCIAL", nunca "FUNCIONANDO").
Testes automatizados (`npx jest`, `test/*.e2e-spec.ts`) usam fontes **simuladas** e verificam a lógica; não homologam nenhuma fonte.

## Situação

| Integração | Código | Situação (teste real em 30/10/2026) |
|---|---|---|
| BrasilAPI | `organizations/external-checks.service.ts` | Funcionando |
| OpenCNPJ | `cnpj-verification/cnpj-verification.service.ts` | Funcionando |
| Mapa das OSCs | `organizations/external-checks.service.ts` | Funcionando (após trocar a rota) |
| Transferegov | `organizations/external-checks.service.ts` | Funcionando (sem autenticação) |
| Portal da Transparência | `organizations/external-checks.service.ts` | Pendente de credencial (endpoints conferem com o swagger oficial) |
| Asaas | `payments/*`, `donations/donations.service.ts` | Pendente de credencial (fluxo só testado com simulação) |

## Fontes de CNPJ e sanções

- **BrasilAPI** `GET /api/cnpj/v1/{cnpj}` — 200 com cadastro; 400 = CNPJ inválido (registrado como ALERTA); 404 = inexistente (ALERTA).
  Bloqueia o User-Agent genérico `node` (403): o backend envia `User-Agent: donatio-tcc/1.0`.
- **OpenCNPJ** `GET https://api.opencnpj.org/{cnpj}` — 200, 400 (`invalid cnpj`), 404 (`not found`). Sem chave, cache de 24h na borda.
  Usado no cadastro da ONG (triagem do CNPJ, `preVerificacaoCnpj`; o selo "cadastro verificado" é calculado à parte, ver `MEDALHAS.md`). Falha/indisponibilidade → 503, nunca aprova.
- **Mapa das OSCs** `GET https://mapaosc.ipea.gov.br/api/api/busca/cnpj/{cnpj}` — lista; **busca por prefixo**, por isso o código só aceita o item com `cd_identificador_osc` idêntico ao CNPJ. Lista vazia = ausência neutra.
  A rota antiga `/api/cnpj/{cnpj}` (que consta no Swagger do Mapa em `/api/docs`) devolve 404: a API é uma aplicação Lumen publicada sob `/api/api/…` e esta rota não existe lá.
  404 passou a ser tratado como **fonte indisponível** (antes virava "OSC não encontrada" e escondia a quebra).
- **Transferegov** `GET https://api-publica.transferegov.gestao.gov.br/parcerias/proposta?cnpj_executor=…|cnpj_ente_recebedor=…` — sem autenticação; filtros exigem 14 dígitos (422 caso contrário); resposta `{data, total_items, …}`. Swagger em `/parcerias/docs`, OpenAPI em `/parcerias/openapi.json`, data da base em `/parcerias/data-atualizacao`.
- **Portal da Transparência** `GET https://api.portaldatransparencia.gov.br/api-de-dados/{ceis|cnep}?codigoSancionado=` e `/cepim?cnpjSancionado=`, header `chave-api-dados`. Limites da API: 429 quando excedido. 401/403 → "chave recusada".

Comportamento comum: timeout de 8s; uma retentativa para erro de rede, 429 e 5xx; qualquer falha vira `INDISPONIVEL` (a ONG segue pendente de análise humana — nada aprova automaticamente); cada consulta grava fonte, status, resumo e `queriedAt` em `organization_external_checks`. Resultado positivo é informativo e **não** garante regularidade institucional.
As URLs são lidas do ambiente no momento do uso (o `.env` só é carregado depois dos imports).

## Asaas (Pix)

- Base: `https://api-sandbox.asaas.com/v3` (padrão) ou produção só com `ASAAS_ENV=production`. Header `access_token` + `User-Agent`.
- Fluxo: doação local PENDENTE → cliente → cobrança Pix (`externalReference` = id da doação) → QR Code. Falha em qualquer etapa cancela a doação e, se a cobrança já existia, a remove no Asaas (`DELETE /payments/{id}`) para não ficar pagável sem doação.
- Webhook: `POST /webhooks/asaas`, header `asaas-access-token` comparado em tempo constante com `ASAAS_WEBHOOK_TOKEN`. O corpo só localiza a cobrança; status e valor vêm de `GET /payments/{id}`. Deduplicação por id do evento (`payment_events`), transação com lock na doação, conferência de id, valor, `externalReference` e `PIX`. 5xx em falha de consulta para o Asaas reenviar.
- Status: PENDING→CONFIRMADA (`RECEIVED`/`CONFIRMED`; `RECEIVED_IN_CASH` não conta), CONFIRMADA→ESTORNADA (refund/chargeback), PENDENTE→CANCELADA (`OVERDUE` ou cobrança removida).
- Limitação conhecida: evento que chegue antes de a cobrança ser vinculada à doação é marcado como ignorado; recuperável por `POST /my/donations/:id/sync` ou `POST /admin/donations/:id/reconcile`.

## Variáveis de ambiente (somente backend, nunca no frontend nem no Git)

`ASAAS_ENV`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `PORTAL_TRANSPARENCIA_API_KEY`; opcionais: `BRASILAPI_URL`, `OPENCNPJ_URL`, `MAPA_OSC_URL`, `TRANSFEREGOV_URL`, `PORTAL_TRANSPARENCIA_URL`. Ver `.env.example`. Os logs registram só status/mensagem, nunca chaves.

## Subcontas Asaas por ONG (Etapa 1 da nova arquitetura de pagamentos)

Cada ONG aprovada ganha uma **subconta própria** (`organization_payment_accounts`, uma por organização). As cobranças da
Etapa 2 serão criadas com a credencial dessa subconta; **não existe retorno à conta da plataforma**: sem subconta ATIVA, do
ambiente atual e com credencial íntegra, `PaymentAccountsService.credentialsFor()` lança erro e a doação é recusada.

- **Abertura**: `POST /admin/payment-accounts/:organizationId {incomeValue}` (somente administrador, ONG precisa estar
  `APROVADA` e com CNPJ, e-mail, telefone e endereço completos; o que faltar vem em `missing`, nada é inventado).
  A linha é reservada no banco antes de chamar o Asaas (índice único por organização), então chamadas simultâneas não
  criam duas contas. Falha no provedor → `FALHA`; só se pode repetir quando nada chegou a ser criado lá.
- **Credencial**: a `apiKey` devolvida (uma única vez) é cifrada com AES-256-GCM usando `PAYMENT_ENCRYPTION_KEY`, amarrada
  ao id da organização (texto copiado para outra ONG não abre). Nunca aparece em respostas, logs ou auditoria.
- **Situação**: `POST .../refresh` consulta `GET /myAccount/status` com a chave da própria subconta (`APPROVED` → ATIVA,
  `REJECTED` → REJEITADA, 401 → BLOQUEADA, o resto → AGUARDANDO_APROVACAO). Só ATIVA libera doações.
  No Sandbox existe ainda `POST .../sandbox-approve` (`POST /accounts/{id}/approve`); em produção é proibido.
- **ONG**: `GET /payment-accounts/me` devolve apenas `status`, `canReceiveDonations` e uma mensagem.
- **Webhooks da subconta**: com `ASAAS_WEBHOOK_URL` definida, a criação já cadastra o webhook da subconta (mesmo
  `ASAAS_WEBHOOK_TOKEN`). Ainda não confirmado no Sandbox real; a Etapa 2 ajusta a reconciliação para consultar o
  pagamento com a credencial da subconta correspondente.
- **Requisitos externos**: a conta Asaas dona de `ASAAS_API_KEY` precisa ser **pessoa jurídica (CNPJ)**. Com conta CPF o
  Asaas responde 403 (verificado no Sandbox em 05/11/2026).
