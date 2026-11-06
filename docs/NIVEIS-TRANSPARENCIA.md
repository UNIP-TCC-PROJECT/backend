# Níveis de transparência

Código: `src/accountability/transparency-level.ts` (função pura) · exposto em `GET /transparency/organizations/:id` → `transparencyLevel`.
Regras na versão `1`. O nível é **calculado a cada consulta** a partir de registros reais: não é armazenado, a ONG não o escolhe
e não existe pontuação nem percentual. Não mede a segurança técnica da plataforma, só o que a ONG registrou e a plataforma analisou.
Quantidade de publicações ou de campanhas **não** entra em nenhum critério.

## Dimensões (cada uma: Atendida · Pendente · Não se aplica ainda)

| Dimensão | Atendida quando | Não se aplica quando |
|---|---|---|
| Identidade institucional | ONG aprovada e consulta cadastral (Receita) registrada | — |
| Documentação | Todos os documentos obrigatórios vigentes estão aprovados | — |
| Transparência financeira | Há despesa aprovada, ou as doações confirmadas têm menos de 60 dias | Não há doações confirmadas |
| Comprovação das despesas | Toda despesa aprovada tem comprovante aprovado | Não há despesa aprovada |
| Entregas e atividades | Toda entrega registrada tem evidência aprovada | Não há entregas registradas |
| Atualização | Houve registro/análise na trilha de auditoria nos últimos 90 dias | — |

## Níveis

| Nível | Exige |
|---|---|
| Avaliação em andamento | Identidade ainda não atendida (dados insuficientes; não indica irregularidade) |
| Transparência inicial | ONG aprovada |
| Transparência em desenvolvimento | Identidade + documentação |
| Transparência avançada | Anterior + financeira e comprovação sem pendência (as não aplicáveis não contam contra) |
| Transparência exemplar | Anterior + entregas sem pendência + atualização + ao menos 1 entrega com evidência aprovada |

Uma ONG nova, sem campanhas, pode chegar a "avançada", mas nunca a "exemplar" sem ter demonstrado uma entrega comprovada.
A resposta inclui, por dimensão, o que foi atendido e o que está pendente, o próximo passo, `evaluatedAt` e a atividade que serviu de base.

## Publicações

Classificação calculada (a ONG não escolhe): **institucional** (sem anexos) · **documentada** (tem anexos, ainda não analisados) ·
**evidências analisadas** (anexo aprovado e publicável, ou vínculo com despesa aprovada / entrega com evidência aprovada).
Imagens exigem declaração de autorização de uso; só são públicas após aprovação do admin; metadados (EXIF/GPS) são removidos.
