# Medalhas: cadastro verificado e nível de transparência

Duas avaliações **independentes**, sempre **calculadas** a partir de registros reais (nunca armazenadas nem editáveis pela ONG), então mudam sozinhas.

| | Cadastro verificado (verde) | Nível de transparência (dourado) |
| --- | --- | --- |
| Pergunta | A instituição passou pela validação institucional da plataforma e continua atendendo aos requisitos? | Que nível de transparência a instituição demonstra? |
| Código | `organizations/registration-verification.ts` (`evaluateRegistration`) | `accountability/transparency-level.ts` (`evaluateTransparency`) |
| Valores | verificado / não verificado (+ ressalvas) | Inicial, Em desenvolvimento, Avançada, Exemplar (ou "Avaliação em andamento") |

## Cadastro verificado — critérios (versão 1)
Todos precisam ser verdadeiros **no momento da consulta**:
1. Organização com status `APROVADA` (suspensa, reprovada, em análise etc. derrubam o selo na hora).
2. Consulta cadastral na Receita Federal (BrasilAPI) registrada, com dados.
3. Todos os documentos obrigatórios vigentes aprovados (lista vazia não conta como "tudo aprovado").

Não é garantia de honestidade, idoneidade nem do uso correto dos recursos. ONGs que só têm o cadastro antigo (sem organização aprovada) **não** têm o selo até concluírem a validação.

### Aprovação com ressalvas
A administração só aprova com consulta indisponível/divergente se informar `overrideReason`. Nesse caso o registro de auditoria `ORG_APPROVED`
(imutável, encadeado por hash) guarda: `overrideReason` (justificativa), `reservations.blockers` e `reservations.checks` (fonte, status, resumo e divergências de cada
consulta ressalvada), o responsável (`actorId`) e a data. O histórico de validações do admin mostra a justificativa e o responsável.
Publicamente aparece só o indicador `comRessalvas`, sem justificativa, divergências nem identificação de quem aprovou.
Aprovações anteriores a esta regra que tenham `overrideReason` na auditoria também contam como "com ressalvas".

## Nível de transparência
Regras inalteradas: ver `NIVEIS-TRANSPARENCIA.md`. Cada nível tem identidade visual própria, só com tokens `brand`:
Inicial = prata (neutro), Em desenvolvimento = bronze, Avançada = dourado, Exemplar = ouro especial (com anel).

### Como as duas avaliações se relacionam
Compartilham dados (consulta cadastral e documentos aprovados), mas têm funções, resultados e telas separados. Consequência das regras atuais:
**cadastro verificado implica documentação aprovada, logo nível pelo menos "Em desenvolvimento"**. "Verificado + Inicial" não ocorre; o inverso ocorre
(documento voltou para análise: sem selo verde e nível Inicial). Qualquer mudança nisso é decisão de regra de negócio.

## Endpoint público de selos
`GET /transparency/selos?ownerIds=1,2,3` (id do usuário-dono da ONG). Sem login.
- **Validação**: `ownerIds` obrigatório, só inteiros positivos (até 9 dígitos), sem repetição, no máximo 50 ids; caso contrário 400. Lista repetida (`ownerIds=1&ownerIds=2`) é rejeitada.
- **Limite**: 60 consultas por minuto por IP (429 depois).
- **Resposta mínima** por id: `cadastroVerificado` (`{verificado:false}` ou `{verificado:true, validadoEm, consultadoEm, comRessalvas, criterios[]}`) e
  `nivelTransparencia` (`{nivel, rotulo}` ou `null`). Nunca documentos, dados pessoais, justificativas, status administrativo ou identificadores internos.
  Ids inexistentes, sem organização ou de organizações não aprovadas devolvem a mesma resposta "sem selo", sem revelar o status.

## Nomes (antes → depois)
| Camada | Antes | Depois |
| --- | --- | --- |
| API pública (`/users/ongs`) | `medalhaVerde`, `medalhaBranca` | removidos; use `/transparency/selos` |
| Entidade `User` | `medalhaVerde` | `preVerificacaoCnpj` (triagem do CNPJ no cadastro; histórico; coluna `medalhaVerde` mantida) |
| Entidade `User` | `medalhaBranca` | `medalhaBrancaLegada` (coluna `medalhaBranca` mantida) |
| `CnpjVerificationService` | `verificacao.medalhaVerde` | `verificacao.cnpjCompativel` |
| Frontend | `somenteMedalhaVerde/Branca`, `medalhaVerde/Branca` | `somenteCadastroVerificado`, `nivelMinimoTransparencia`, `cadastroVerificado`, `nivelTransparencia` |

Não há migração: nenhuma coluna foi renomeada, apagada ou alterada.
