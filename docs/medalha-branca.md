# Medalha Branca (programa encerrado — somente histórico)

O programa da Medalha Branca foi **encerrado**. A verificação documental passou a ser feita na validação institucional
(documentos da instituição) e sustenta o **cadastro verificado** (ver `MEDALHAS.md`). Nada do histórico foi apagado.

## O que continua disponível
- `medalha_branca_pedido` e `medalha_branca_documento` permanecem intactas (pedidos, análises, motivos e arquivos em `bytea`).
- A coluna `user.medalhaBranca` permanece, e no código o campo se chama `User.medalhaBrancaLegada` (mapeado com `@Column({ name: 'medalhaBranca' })`).
  Ela é só registro histórico: não aparece em nenhuma API pública e não influencia nenhuma medalha.
- A ONG vê o próprio histórico no Perfil; o administrador vê o histórico da ONG no painel (somente leitura, com download dos documentos).

## O que foi desativado
- `POST /medalha-branca/minha` (novo pedido) e `PATCH /medalha-branca/admin/:id` (análise) respondem **410 Gone**, depois de a autenticação e a autorização
  serem avaliadas. Nada é gravado.
- Pedidos que estavam `Pendente` quando o programa terminou continuam listados como histórico e não podem mais ser analisados.
  (Na base atual não há nenhum.)

## API (todas exigem `Authorization: Bearer <token>`)

| Método | Rota | Acesso |
| --- | --- | --- |
| GET | `/medalha-branca/minha` | ONG ativa, próprio histórico |
| GET | `/medalha-branca/documentos/:id` | Proprietária ou administrador ativo |
| GET | `/medalha-branca/admin/ongs/:ongId` | Administrador |
| POST | `/medalha-branca/minha` | ONG ativa — **410** (programa encerrado) |
| PATCH | `/medalha-branca/admin/:id` | Administrador — **410** (programa encerrado) |

Os downloads usam token da própria ONG ou de administrador, com `Cache-Control: private, no-store`.

## Verificação

```sh
node node_modules/jest/bin/jest.js --config test/jest-medalha-branca.json --runInBand
```

O teste cria um schema temporário `teste_medalha_*`, semeia um histórico (pedido recusado e aprovado, com documento) e verifica: histórico preservado e
ordenado, autorização, isolamento entre ONGs, privacidade dos documentos, **410 sem gravar nada**, e que as APIs públicas não expõem campos de medalha por cor.
