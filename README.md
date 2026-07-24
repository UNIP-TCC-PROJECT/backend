# UNIP TCC — Backend

API REST desenvolvida em **NestJS + TypeScript** com banco **PostgreSQL**, executada **100% via Docker**. O backend é um sistema de doações que oferece cadastro de ONGs e doadores, login unificado e listagem de ONGs cadastradas.

## Sumário

- [Sobre o projeto](#sobre-o-projeto)
- [Tecnologias](#tecnologias)
- [Pré-requisitos](#pré-requisitos)
- [Como instalar e rodar](#como-instalar-e-rodar)
- [Scripts disponíveis](#scripts-disponíveis)
- [Perfis de configuração](#perfis-de-configuração)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Rotas da API](#rotas-da-api)
  - [GET /](#get-)
  - [POST /users](#post-users)
  - [POST /users/login](#post-userslogin)
  - [GET /users/ongs](#get-usersongs)
- [Seed de ONGs](#seed-de-ongs)
- [Parar o projeto](#parar-o-projeto)
- [Solução de problemas](#solução-de-problemas)
- [Observações](#observações)

## Sobre o projeto

Back-end da aplicação UNIP TCC — um sistema de doações que conecta ONGs e doadores. Ele expõe uma **API REST** consumida pelo aplicativo mobile (front-end) e oferece:

- **Cadastro de usuários** — o mesmo endpoint atende ONGs e Doadores, diferenciados pelo campo `type`
- **Login unificado** — autenticação única para ambos os tipos de usuário
- **Listagem de ONGs** — retorna apenas os campos públicos das ONGs cadastradas
- **Healthcheck** — rota simples para verificar se a API está no ar

O projeto roda **100% via Docker**, incluindo o banco de dados PostgreSQL e o próprio backend. O objetivo é garantir que qualquer pessoa consiga subir o sistema com um único comando. As senhas são criptografadas com `bcrypt` antes de serem salvas e nunca são retornadas nas respostas.

## Tecnologias

- [NestJS](https://nestjs.com/) — framework Node.js para construção da API
- [TypeScript](https://www.typescriptlang.org/) — linguagem principal do projeto
- [PostgreSQL](https://www.postgresql.org/) — banco de dados relacional
- [Docker](https://www.docker.com/) / Docker Compose — ambiente de execução (banco + backend)
- [TypeORM](https://typeorm.io/) — mapeamento objeto-relacional (ORM)
- [class-validator](https://github.com/typestack/class-validator) — validação dos dados de entrada (DTOs)
- [bcrypt](https://www.npmjs.com/package/bcrypt) — criptografia de senhas
- [Jest](https://jestjs.io/) — testes unitários e end-to-end
- [Yarn](https://yarnpkg.com/) — gerenciador de pacotes

## Pré-requisitos

Antes de começar, você precisa ter instalado na sua máquina:

- **[Docker Desktop](https://www.docker.com/get-started/)** — para subir o banco e o backend em containers
- **[Yarn](https://yarnpkg.com/getting-started/install)** — gerenciador de pacotes usado neste projeto
- **[Node.js](https://nodejs.org/)** — necessário para instalar as dependências localmente e rodar o seed
- **[Git](https://git-scm.com/downloads)** — para clonar o repositório

> **Importante:** não é necessário instalar o PostgreSQL localmente — o banco roda inteiramente via Docker.

## Como instalar e rodar

1. Clone o repositório e entre na pasta do backend:
   ```bash
   git clone <URL_DO_REPO>
   cd UNIP-TCC/backend
   ```

2. Instale as dependências localmente (necessário para o editor reconhecer os tipos e para rodar o seed):
   ```bash
   yarn
   ```

3. Suba o sistema completo (banco + backend) via Docker:
   ```bash
   yarn dev
   ```

Esse comando faz tudo automaticamente:

- Sobe o PostgreSQL via Docker
- Sobe o backend NestJS
- Conecta o banco automaticamente

> Internamente o `yarn dev` executa `docker compose up --build`, recriando os containers a cada inicialização.

Após subir o projeto, os serviços ficam disponíveis em:

- **Backend (API):** http://localhost:3000
- **Banco de dados:** localhost:5432

## Scripts disponíveis

Além do `yarn dev`, o `package.json` disponibiliza outros comandos:

| Comando | Descrição |
|---|---|
| `yarn dev` | Sobe tudo via Docker (banco + backend) |
| `yarn docker:up` | Sobe os containers em segundo plano (`-d`) |
| `yarn docker:down` | Para e remove os containers |
| `yarn start:dev` | Roda o backend localmente em modo watch (sem Docker) |
| `yarn build` | Compila o projeto para a pasta `dist` |
| `yarn lint` | Roda o ESLint e corrige problemas automaticamente |
| `yarn format` | Formata o código com o Prettier |
| `yarn test` | Executa os testes unitários (Jest) |
| `yarn test:e2e` | Executa os testes end-to-end |

## Perfis de configuração

O backend é configurado por **variáveis de ambiente** e por **Docker Compose**. Para desenvolvimento local, o `yarn dev` já sobe o banco e o backend com as configurações padrão, sem necessidade de ajustes manuais.

| Variável | Obrigatória | Descrição |
|---|:---:|---|
| `DATABASE_HOST` | ✅ | Host do banco PostgreSQL (ex.: `db` dentro do Docker, `localhost` fora) |
| `DATABASE_PORT` | ✅ | Porta do banco (padrão: `5432`) |
| `DATABASE_USER` | ✅ | Usuário do banco |
| `DATABASE_PASSWORD` | ✅ | Senha do banco |
| `DATABASE_NAME` | ✅ | Nome do banco de dados |
| `PORT` | ❌ | Porta em que a API é exposta (padrão: `3000`) |

> Ao rodar o backend **fora do Docker** (via `yarn start:dev`), aponte `DATABASE_HOST` para `localhost`. Dentro do Docker, use o nome do serviço do banco definido no `docker-compose`.

## Estrutura do projeto

```
backend/
├── src/
│   ├── users/          # Módulo de usuários (controller, service, entity, DTOs)
│   ├── app.module.ts   # Módulo raiz da aplicação
│   ├── app.controller.ts  # Controller do healthcheck (GET /)
│   └── main.ts         # Ponto de entrada da aplicação NestJS
├── test/               # Testes end-to-end (e2e)
├── seed-ongs.ts        # Script de seed para popular ONGs iniciais
├── docker-compose.yml  # Orquestração dos containers (banco + backend)
├── Dockerfile          # Imagem do backend
└── package.json        # Dependências e scripts
```

## Rotas da API

Base URL: `http://localhost:3000`

Todas as rotas trocam dados no formato **JSON** (`Content-Type: application/json`).

### Resumo

| Método | Rota | Para que serve | Corpo (body) |
|---|---|---|---|
| `GET` | `/` | Healthcheck — verifica se a API está no ar | — |
| `POST` | `/users` | Cadastra um usuário (ONG ou Doador) | `CreateUserDto` |
| `POST` | `/users/login` | Realiza o login unificado (ONG ou Doador) | `LoginDto` |
| `GET` | `/users/ongs` | Lista todas as ONGs cadastradas | — |

### GET /

Rota de healthcheck. Retorna uma string simples confirmando que o backend está rodando.

**Resposta (200):**

```text
Hello World!
```

### POST /users

Cadastra um novo usuário no sistema. O mesmo endpoint serve para **ONG** e **Doador** — o que muda é o campo `type` e os campos específicos de cada tipo.

A senha é criptografada com `bcrypt` antes de ser salva e **nunca** é retornada na resposta. Emails são únicos: tentar cadastrar um email já existente retorna erro `409`.

**Corpo da requisição — `CreateUserDto`:**

| Campo | Tipo | Obrigatório | Regras / Observações |
|---|---|---|---|
| `name` | `string` | ✅ Sim | Mínimo de 3 caracteres |
| `email` | `string` | ✅ Sim | Formato de email válido e único |
| `password` | `string` | ✅ Sim | Mínimo de 6 caracteres |
| `type` | `"ONG"` \| `"DOADOR"` | ✅ Sim | Define o tipo do usuário |
| `cnpj` | `string` | ❌ Não | Usado para ONGs |
| `description` | `string` | ❌ Não | Descrição da ONG |
| `cpf` | `string` | ❌ Não | Usado para Doadores |
| `phone` | `string` | ❌ Não | Telefone do Doador |

**Exemplo — cadastro de ONG:**

```json
{
  "name": "ONG Esperança",
  "email": "contato@esperanca.org",
  "password": "senha123",
  "type": "ONG",
  "cnpj": "12.345.678/0001-90",
  "description": "Apoio a famílias em situação de vulnerabilidade"
}
```

**Exemplo — cadastro de Doador:**

```json
{
  "name": "João da Silva",
  "email": "joao@email.com",
  "password": "senha123",
  "type": "DOADOR",
  "cpf": "123.456.789-00",
  "phone": "(11) 99999-9999"
}
```

**Resposta (201):** dados do usuário criado, **sem** o campo `password`.

```json
{
  "name": "ONG Esperança",
  "email": "contato@esperanca.org",
  "type": "ONG",
  "cnpj": "12.345.678/0001-90",
  "description": "Apoio a famílias em situação de vulnerabilidade",
  "id": 1,
  "createdAt": "2026-06-29T12:00:00.000Z"
}
```

**Erros possíveis:**

- `400 Bad Request` — campos inválidos (validação do `class-validator`)
- `409 Conflict` — `Email já cadastrado`

### POST /users/login

Realiza o login unificado. Funciona tanto para ONGs quanto para Doadores.

**Corpo da requisição — `LoginDto`:**

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `email` | `string` | ✅ Sim | Formato de email válido |
| `password` | `string` | ✅ Sim | Senha do usuário |

**Exemplo:**

```json
{
  "email": "contato@esperanca.org",
  "password": "senha123"
}
```

**Resposta (200/201):** dados do usuário autenticado, **sem** o campo `password`.

**Erros possíveis:**

- `400 Bad Request` — campos inválidos
- `401 Unauthorized` — `Email ou senha inválidos`

### GET /users/ongs

Lista todas as ONGs cadastradas (usuários com `type = "ONG"`). Retorna apenas campos públicos — senha e dados sensíveis não são expostos.

**Resposta (200):**

```json
[
  {
    "id": 1,
    "name": "ONG Esperança",
    "email": "contato@esperanca.org",
    "cnpj": "12.345.678/0001-90",
    "description": "Apoio a famílias em situação de vulnerabilidade",
    "createdAt": "2026-06-29T12:00:00.000Z"
  }
]
```

## Seed de ONGs

O projeto possui o arquivo `seed-ongs.ts`, responsável por cadastrar ONGs iniciais no banco de dados para testes.

1. Caso não tenha o `ts-node` instalado globalmente, execute:
   ```bash
   yarn global add ts-node typescript
   ```
   ou:
   ```bash
   npm install -g ts-node typescript
   ```

2. Com o projeto rodando, execute o seed:
   ```bash
   yarn ts-node seed-ongs.ts
   ```

Esse comando irá:

- Conectar no PostgreSQL
- Inserir ONGs de exemplo
- Evitar duplicação caso já existam

**Resultado esperado:**

```bash
ONG ONG Esperança cadastrada.
ONG ONG Vida Nova cadastrada.
Seed finalizado.
```

## Parar o projeto

Para parar e remover os containers:

```bash
docker compose down
```

## Solução de problemas

**Docker não inicia**

Verifique se o Docker Desktop está aberto.

**Erro de conexão com banco**

Recrie os containers:

```bash
docker compose down
docker compose up --build
```

**Seed não funciona**

Verifique se:

- O backend está rodando
- O banco Docker foi iniciado
- As dependências foram instaladas com `yarn`

## Observações

- **Não** é necessário instalar PostgreSQL localmente — tudo roda via Docker.
- **Não** use `npm install` no backend; sempre utilize `yarn`.
- Sempre use `yarn dev` para iniciar o projeto completo.
- Durante o desenvolvimento, o backend roda automaticamente em modo watch dentro do container, recarregando a cada alteração no código.
- As senhas são criptografadas com `bcrypt` e nunca retornam nas respostas da API.
