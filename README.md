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

---

## 3. Subir o sistema

```bash
yarn dev
```

👉 Esse comando faz tudo automaticamente:

- Sobe o PostgreSQL via Docker
- Sobe o backend NestJS
- Conecta o banco automaticamente

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
