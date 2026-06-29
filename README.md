# 🚀 UNIP TCC Project

Sistema de doações com cadastro de ONGs e doadores.

---

# 📦 Tecnologias

- NestJS (Backend)
- PostgreSQL (Banco de dados)
- Docker (Ambiente)
- Yarn (Gerenciador de pacotes)

---

# 🧠 Visão geral

Este projeto roda **100% via Docker**, incluindo o banco de dados e o backend.

👉 O objetivo é garantir que qualquer pessoa consiga rodar o sistema com apenas um comando.

O backend expõe uma **API REST** que permite:

- Cadastrar usuários (ONGs e Doadores)
- Fazer login unificado
- Listar as ONGs cadastradas

---

# ⚙️ Pré-requisitos

Antes de iniciar, instale:

- [Docker Desktop](https://www.docker.com/get-started/)
- [Yarn](https://yarnpkg.com/getting-started/install)
- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/)

---

# 🚀 Como rodar o projeto (PASSO A PASSO)

## 1. Clonar o repositório

```bash
git clone <URL_DO_REPO>
cd UNIP-TCC/backend
```

---

## 2. Instalar dependências

```bash
yarn
```

> Instala as dependências localmente (necessário para o editor reconhecer os tipos e para rodar o seed).

---

## 3. Subir o sistema

```bash
yarn dev
```

👉 Esse comando faz tudo automaticamente:

- Sobe o PostgreSQL via Docker
- Sobe o backend NestJS
- Conecta o banco automaticamente

> Internamente o `yarn dev` executa `docker compose up --build`, recriando os containers a cada inicialização.

---

## 🧩 Scripts úteis

Além do `yarn dev`, o `package.json` disponibiliza outros comandos:

| Comando             | O que faz                                              |
| ------------------- | ------------------------------------------------------ |
| `yarn dev`          | Sobe tudo via Docker (banco + backend)                 |
| `yarn docker:up`    | Sobe os containers em segundo plano (`-d`)             |
| `yarn docker:down`  | Para e remove os containers                            |
| `yarn start:dev`    | Roda o backend localmente em modo watch (sem Docker)   |
| `yarn build`        | Compila o projeto para a pasta `dist`                  |
| `yarn lint`         | Roda o ESLint e corrige problemas automaticamente      |
| `yarn format`       | Formata o código com o Prettier                        |
| `yarn test`         | Executa os testes unitários (Jest)                     |
| `yarn test:e2e`     | Executa os testes end-to-end                           |

---

# 🐳 O que acontece ao rodar `yarn dev`

- Docker Compose inicia os containers
- Banco de dados PostgreSQL sobe
- Backend NestJS inicia dentro do Docker
- Aplicação fica disponível

---

# 🌱 Seed de ONGs

O projeto possui um arquivo chamado:

```bash
seed-ongs.ts
```

Esse arquivo é responsável por cadastrar ONGs iniciais no banco de dados para testes.

---

## 📥 Instalar ts-node

Caso não tenha o `ts-node` instalado globalmente, execute:

```bash
yarn global add ts-node typescript
```

ou:

```bash
npm install -g ts-node typescript
```

---

## ▶️ Executar o seed

Com o projeto rodando, execute:

```bash
yarn ts-node seed-ongs.ts
```

👉 Esse comando irá:

- Conectar no PostgreSQL
- Inserir ONGs de exemplo
- Evitar duplicação caso já existam

---

## ✅ Resultado esperado

Após executar o seed, você verá algo parecido com:

```bash
ONG ONG Esperança cadastrada.
ONG ONG Vida Nova cadastrada.
Seed finalizado.
```

---

# 🌐 Acesso

Após subir o projeto:

- Backend: http://localhost:3000
- Banco: localhost:5432

---

# 🧪 Estrutura do sistema

- Cadastro de ONGs
- Cadastro de Doadores
- Login unificado
- API REST

---

# 📡 Rotas da API

Base URL: `http://localhost:3000`

Todas as rotas trocam dados no formato **JSON** (`Content-Type: application/json`).

## Resumo

| Método | Rota           | Para que serve                                 | Corpo (body)     |
| ------ | -------------- | ---------------------------------------------- | ---------------- |
| `GET`  | `/`            | Healthcheck — verifica se a API está no ar     | —                |
| `POST` | `/users`       | Cadastra um usuário (ONG ou Doador)            | `CreateUserDto`  |
| `POST` | `/users/login` | Realiza o login unificado (ONG ou Doador)      | `LoginDto`       |
| `GET`  | `/users/ongs`  | Lista todas as ONGs cadastradas                | —                |

---

## `GET /`

Rota de healthcheck. Retorna uma string simples confirmando que o backend está rodando.

**Resposta (200):**

```text
Hello World!
```

---

## `POST /users`

Cadastra um novo usuário no sistema. O mesmo endpoint serve para **ONG** e **Doador** — o que muda é o campo `type` e os campos específicos de cada tipo.

A senha é criptografada com `bcrypt` antes de ser salva e **nunca** é retornada na resposta. Emails são únicos: tentar cadastrar um email já existente retorna erro `409`.

**Corpo da requisição — `CreateUserDto`:**

| Campo         | Tipo                  | Obrigatório | Regras / Observações                       |
| ------------- | --------------------- | ----------- | ------------------------------------------ |
| `name`        | `string`              | ✅ Sim      | Mínimo de 3 caracteres                     |
| `email`       | `string`              | ✅ Sim      | Formato de email válido e único            |
| `password`    | `string`              | ✅ Sim      | Mínimo de 6 caracteres                     |
| `type`        | `"ONG"` \| `"DOADOR"` | ✅ Sim      | Define o tipo do usuário                   |
| `cnpj`        | `string`              | ❌ Não      | Usado para ONGs                            |
| `description` | `string`              | ❌ Não      | Descrição da ONG                           |
| `cpf`         | `string`              | ❌ Não      | Usado para Doadores                        |
| `phone`       | `string`              | ❌ Não      | Telefone do Doador                         |

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

---

## `POST /users/login`

Realiza o login unificado. Funciona tanto para ONGs quanto para Doadores.

**Corpo da requisição — `LoginDto`:**

| Campo      | Tipo     | Obrigatório | Regras                  |
| ---------- | -------- | ----------- | ----------------------- |
| `email`    | `string` | ✅ Sim      | Formato de email válido |
| `password` | `string` | ✅ Sim      | Senha do usuário        |

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

---

## `GET /users/ongs`

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

---

# ⚠️ Observações importantes

- NÃO é necessário instalar PostgreSQL localmente
- Tudo roda via Docker
- Não use `npm install` no backend
- Sempre use `yarn dev` para iniciar o projeto

---

# 🛑 Parar o projeto

```bash
docker compose down
```

---

# 🔧 Solução de problemas

## Docker não inicia

Verifique se o Docker Desktop está aberto.

---

## Erro de conexão com banco

Execute:

```bash
docker compose down
docker compose up --build
```

---

## Seed não funciona

Verifique se:

- O backend está rodando
- O banco Docker foi iniciado
- As dependências foram instaladas com `yarn`

---

# 👨‍💻 Desenvolvimento

Para desenvolvimento, o backend roda automaticamente em modo watch dentro do container.
