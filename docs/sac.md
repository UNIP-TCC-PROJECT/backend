# Atendimento SAC

O SAC permite que doadores e ONGs conversem com a administração. Cada conta tem uma conversa própria, com histórico. Todos os administradores compartilham a caixa de atendimento e as respostas identificam quem respondeu.

## Como testar no aplicativo

1. Entre com uma conta de doador ou ONG.
2. Abra **Ajuda → Falar com a administração**, ou **menu da conta → Atendimento SAC**.
3. Clique em **Iniciar atendimento**, escreva uma mensagem e envie.
4. Em outro navegador ou janela anônima, entre como administrador e conclua a verificação em duas etapas.
5. No painel, abra **Atendimento SAC**, selecione a pessoa e responda.
6. Volte à janela do usuário. A resposta aparece automaticamente; a consulta ocorre a cada cinco segundos enquanto a página está visível.
7. Saia e entre novamente: **Continuar atendimento** abre o mesmo histórico.
8. Confira com outra conta: ela não deve ver a conversa anterior.

As mensagens aceitam até 2.000 caracteres. Visitantes precisam entrar na conta. Contas suspensas ou banidas não podem acessar o SAC. Administradores precisam de MFA verificado na sessão. O atendimento não exige doação prévia nem aprovação institucional da ONG.

## Banco e execução

A migration `AtendimentoSac1793364490090` adiciona apenas `sac_conversas` e `sac_mensagens`. As conversas entre doador e ONG continuam nas tabelas anteriores. Nenhum cadastro ou dado antigo é apagado.

Em outra instalação, execute na pasta `backend`:

```powershell
docker compose exec -T backend npm run migration:run
docker compose restart backend
```

O `docker compose up` também executa migrations ao iniciar o backend. O frontend precisa estar atualizado e em execução (`yarn dev` na pasta `frontend`).

## Testes automatizados

```powershell
docker compose exec -T backend npm test -- --runInBand sac/sac.service.spec.ts
docker compose exec -T -e SAC_DB_TEST=1 backend npm test -- --runInBand sac/
```

A segunda opção exige a migration aplicada. Os testes de integração criam dados fictícios em uma transação e fazem rollback ao terminar, inclusive em caso de falha. Verificam criação idempotente, troca de mensagens, privacidade, campos retornados, limites de texto, MFA e bloqueio de conta suspensa. As sequências de IDs podem avançar durante os testes, sem alterar os registros existentes.
