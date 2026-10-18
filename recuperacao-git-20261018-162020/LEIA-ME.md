# Recuperação dos repositórios — 18/10/2026

## Pastas de trabalho

- Backend: `C:\Users\lauan\OneDrive\Documentos\TCC\backend`
- Frontend: `C:\Users\lauan\OneDrive\Documentos\TCC\frontend`

A pasta `TCC` também contém uma cópia antiga do backend com seu próprio Git. Ela não foi removida nem sincronizada. Abra as subpastas acima para trabalhar nos projetos recuperados.

## Problemas encontrados

- A `main` local do backend apontava para um commit antigo de implementação, com uma mesclagem interrompida em oito arquivos e outras exclusões locais.
- A `medalha-branca` do backend ainda não incorporava os oito commits mais recentes da `main`. Um commit chamado “Merge remote-tracking branch...” tinha apenas um pai e não registrava essa integração.
- Arquivos e regras da administração e das publicações estavam ausentes na branch de trabalho.
- A `medalha-branca` do frontend estava cinco commits atrás da `main`, sem commits exclusivos.
- O Git usava `Lauane267`; a conta com acesso é `lauaneveraszta`.

## Recuperação local

- Cópia do código e dos metadados Git do backend antes da recuperação: `backend/` dentro desta pasta de backup. Inclui alterações sem commit e o estado da mesclagem interrompida.
- Cópia dos metadados Git do frontend: `frontend-git/`.
- Cópia da alteração local do backend antigo: `auth.module-copia-TCC.ts`.
- Os arquivos enviados pelos usuários em `TCC/backend/uploads`, as dependências e os arquivos de compilação não foram copiados nem removidos.
- A mesclagem interrompida foi cancelada depois de conferir o backup.
- A correção foi preparada em `codex/recuperar-integracao`, preservando o histórico de `medalha-branca`, e incorporada à `medalha-branca` local sem reescrever commits.
- A `main` local foi alinhada à `origin/main`; sua referência anterior continua em `codex/backup-main-20261018`.
- Foram reunidos administração, publicações, foto de perfil e metas. Foram preservadas as regras de login de contas ativas e os campos permitidos na edição de perfil, além da consulta pública das metas de uma ONG.
- O arquivo de dependências e a configuração dos testes foram corrigidos. Os testes existentes foram ajustados e foram adicionadas verificações de foto de perfil e das regras preservadas.
- No frontend, `medalha-branca` avançou até a `main`, sem conflito.
- Os dois repositórios foram configurados localmente para usar a conta `lauaneveraszta`.

## Validação

- Backend: 7 suítes de testes, 25 testes aprovados.
- Backend e frontend: compilação aprovada durante a recuperação.
- Ambos os repositórios sem arquivos em conflito e sem alterações locais pendentes após os commits.
- Não foi executado teste completo com banco de dados e navegação no aplicativo.

## Envio ao GitHub

- Backend: `origin/medalha-branca` atualizado de `81b6083` para `9757cbc`.
- Frontend: `origin/medalha-branca` atualizado de `00cad23` para `efc729c`.
- Envios normais, sem force push. A `main` remota não foi alterada.
- As duas branches locais estão sincronizadas com suas correspondentes no GitHub e contêm a `main` atual de cada repositório.

## Fluxo para as próximas alterações

Dentro da pasta do projeto correto, antes de continuar uma branch existente:

```powershell
git status
git fetch origin
git switch medalha-branca
git merge origin/main
```

Se houver alterações locais no primeiro comando, salve-as em um commit antes de trocar de branch ou mesclar. Se a mesclagem apontar conflitos, resolva-os antes de continuar. Depois, compile, teste, faça o commit e envie com `git push origin medalha-branca`.

Atualizar a `main` local não atualiza automaticamente sua branch: é necessário incorporar `origin/main` à branch em que você trabalha.

Esta pasta de backup deve permanecer local: ela contém uma cópia da configuração `.env` original.
