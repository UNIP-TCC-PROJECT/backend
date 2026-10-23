# Medalha Branca

## Uso

- ONG ativa: na página **ONGs**, abra **Solicitar Medalha Branca**. Envie de 1 a 5 arquivos PDF, JPG ou PNG de até 5 MB cada.
- A solicitação passa de `NaoSolicitado` para `Pendente`. O painel mostra os arquivos enviados e permite baixá-los.
- Administrador: abra uma ONG no painel administrativo. A seção **Análise da Medalha Branca** permite baixar os documentos e aprovar ou recusar. A recusa exige um motivo.
- O painel da ONG consulta o resultado ao abrir, ao voltar à janela e a cada 30 segundos enquanto estiver aberto. Também há **Atualizar status**.
- `Recusado` permite novo envio e preserva o histórico. `Pendente` e `Aprovado` bloqueiam novas solicitações. A aprovação marca `User.medalhaBranca` como verdadeiro.

## Integração e dados

O frontend adiciona um componente em `Ongs.tsx` e outro em `admin/AdminOngDetails.tsx`. Rotas, autenticação, perfil, avatar e detalhes públicos da ONG mantêm seus componentes e serviços existentes.

O backend usa duas tabelas novas: `medalha_branca_pedido` e `medalha_branca_documento`. A configuração de desenvolvimento existente (`synchronize: true`) cria as tabelas ao iniciar. A entidade antiga `Medalha` permanece intacta. Para ambientes com sincronização desativada, inclua as tabelas em uma migração antes de publicar.

Os documentos são armazenados em `bytea` no PostgreSQL, na mesma transação da solicitação. Isso evita arquivos órfãos e não utiliza o diretório público de fotos. O conteúdo binário é excluído das consultas de status. Inclua essas tabelas nos backups do banco.

A identificação da ONG vem do token, nunca de um campo enviado no formulário. Downloads exigem token da própria ONG ou de administrador. Um bloqueio de transação por ONG e um índice único para pedidos pendentes impedem envios concorrentes duplicados.

## API

Todas as rotas exigem `Authorization: Bearer <token>`.

| Método | Rota | Acesso |
| --- | --- | --- |
| GET | `/medalha-branca/minha` | ONG ativa, próprios pedidos |
| POST | `/medalha-branca/minha` | ONG ativa; multipart com campo `documentos` repetido |
| GET | `/medalha-branca/documentos/:id` | Proprietária ou administrador ativo |
| GET | `/medalha-branca/admin/ongs/:ongId` | Administrador |
| PATCH | `/medalha-branca/admin/:id` | Administrador ativo; `{ "status": "Aprovado" }` ou `{ "status": "Recusado", "motivo": "..." }` |

## Verificação

Na pasta do backend:

```sh
npm test -- --runInBand
npm run build
node node_modules/jest/bin/jest.js --config test/jest-medalha-branca.json --runInBand
```

O teste de integração precisa das variáveis de conexão PostgreSQL e `JWT_SECRET`, e pode ser executado dentro do container `nest-api`. Ele cria um schema temporário `teste_medalha_*`, usa contas fictícias e remove o schema ao terminar. Verifica autorização, isolamento entre ONGs, validação de arquivos, concorrência, recusa, reenvio, aprovação, preservação do perfil e upload/exibição de foto. Não modifica os cadastros reais.

No frontend, execute `npm run build` para validar os componentes e a integração.
