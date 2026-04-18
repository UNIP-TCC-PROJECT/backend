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

- Docker Desktop
- Yarn
- Git

---

# 🚀 Como rodar o projeto (PASSO A PASSO)

## 1. Clonar o repositório

```bash
git clone <URL_DO_REPO>
cd UNIP-TCC/backend
```

## 2. Subir o sistema

```bash
yarn dev
```

👉 Esse comando faz tudo automaticamente:

- Sobe o PostgreSQL via Docker
- Sobe o backend NestJS
- Conecta o banco automaticamente

## 🐳 O que acontece ao rodar `yarn dev`

- Docker Compose inicia os containers
- Banco de dados PostgreSQL sobe
- Backend NestJS inicia dentro do Docker
- Aplicação fica disponível

## 🌐 Acesso

Após subir o projeto:

- Backend: http://localhost:3000
- Banco: localhost:5432

## 🧪 Estrutura do sistema

- Cadastro de ONGs
- Cadastro de Doadores
- Login unificado
- API REST

## ⚠️ Observações importantes

- NÃO é necessário instalar PostgreSQL localmente
- Tudo roda via Docker
- Não use `npm install` no backend
- Sempre use `yarn dev` para iniciar o projeto

## 🛑 Parar o projeto

```bash
docker compose down
```

## 🔧 Solução de problemas

**Docker não inicia**

Verifique se o Docker Desktop está aberto.

**Erro de conexão com banco**

Execute:

```bash
docker compose down
docker compose up --build
```

## 👨‍💻 Desenvolvimento

Para desenvolvimento, o backend roda automaticamente em modo watch dentro do container.
