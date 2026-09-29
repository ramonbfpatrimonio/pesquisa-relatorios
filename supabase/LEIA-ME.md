# Montando o banco compartilhado no Supabase

Faça uma vez só. Leva uns 15 minutos.

## 1. Criar o projeto
1. Entre em https://supabase.com e faça login.
2. **New project**. Nome: `pesquisa-relatorios`. Escolha uma senha do banco (guarde) e a região **South America (São Paulo)**.
3. Espere terminar de criar.

## 2. Criar as tabelas
1. Menu da esquerda: **SQL Editor** > **New query**.
2. Abra o arquivo `supabase/01-banco.sql`, copie **tudo**, cole e clique **Run**.
3. Deve aparecer "Success". Pode rodar de novo sem problema.

## 3. Criar o administrador master
1. Menu: **Authentication** > **Users** > **Add user** > **Create new user**.
2. E-mail: `patrimonio@patrimonio.com` — defina a senha — marque **Auto Confirm User** — **Create user**.
3. O e-mail já foi registrado como admin pelo SQL do passo 2.

## 4. Impedir cadastro por conta própria
**Authentication** > **Sign In / Providers** (ou "Settings") > desligue **Allow new users to sign up** e salve.
(Usuários novos só nascem pelo programa, criados por um admin.)

## 5. Publicar a função de usuários
1. Menu: **Edge Functions** > **Deploy a new function** > **Via Editor**.
2. Nome: `gerenciar-usuarios`.
3. Apague o exemplo, cole o conteúdo de `supabase/functions/gerenciar-usuarios/index.ts` e clique **Deploy**.
4. Deixe **Verify JWT** ligado.

(Os nomes dos botões podem variar um pouco conforme o Supabase muda o painel.)

## 6. Pegar a URL e a chave
**Project Settings** > **API** (ou "API Keys"):
- **Project URL** (algo como `https://abcdefgh.supabase.co`)
- **anon / public key** (começa com `eyJ...`)

Mande os dois para quem faz a versão do programa (ou cole em `src/nuvem-config.js` antes de gerar o instalador).
**Nunca use nem envie a chave `service_role`.** Ela não entra no programa.

## 7. Primeira carga dos dados
1. Abra o programa numa máquina que tenha os dados completos.
2. `Ctrl+Shift+B` e entre com o e-mail e a senha do admin.
3. **Configurações** > **Sincronização** > **Enviar dados desta máquina para a nuvem**.
4. Pronto. As outras máquinas recebem sozinhas, em segundos, e o que for cadastrado dali em diante aparece em todas.

## Dúvidas comuns
- **Projeto gratuito pausa por inatividade** (cerca de 1 semana sem uso). Se pausar, é só clicar em "Restore" no painel. Para uso diário, o plano pago evita isso.
- **Sem internet**: o programa abre e pesquisa com os dados da última sincronização. Para editar precisa estar online.
- **Trocar senha**: Configurações > Conta > Alterar minha senha.
