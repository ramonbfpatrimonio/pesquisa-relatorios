// Função "gerenciar-usuarios" — roda no servidor do Supabase.
// Só administrador consegue usar. É ela que cria, exclui e troca senha/papel de usuários,
// porque isso exige a chave de administração, que NUNCA fica dentro do programa instalado.
//
// Como publicar: Supabase > Edge Functions > Deploy a new function > Via Editor
//   nome: gerenciar-usuarios   |  cole este arquivo inteiro  |  Deploy
//   (deixe "Verify JWT" ligado)

import { createClient } from 'npm:@supabase/supabase-js@2';

const cabecalhos = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: cabecalhos });

const PAPEIS = ['admin', 'editor'];
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecalhos });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1) quem está pedindo?
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: sessao, error: erroSessao } = await createClient(url, anon).auth.getUser(token);
    const chamador = sessao?.user?.email?.toLowerCase();
    if (erroSessao || !chamador) return responder({ erro: 'Sessão inválida. Entre de novo.' }, 401);

    const admin = createClient(url, servico, { auth: { persistSession: false } });

    // 2) é administrador?
    const { data: perfil } = await admin.from('usuarios').select('papel').eq('email', chamador).maybeSingle();
    if (perfil?.papel !== 'admin') return responder({ erro: 'Só administrador pode gerenciar usuários.' }, 403);

    // 3) o que ele quer fazer?
    const { acao, email, senha, papel } = await req.json();
    const alvo = String(email ?? '').trim().toLowerCase();
    if (!EMAIL_OK.test(alvo)) return responder({ erro: 'E-mail inválido.' }, 400);

    const acharUsuarioAuth = async () => {
      for (let pagina = 1; pagina <= 20; pagina++) {
        const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
        if (error) throw error;
        const achado = data.users.find((u) => u.email?.toLowerCase() === alvo);
        if (achado) return achado;
        if (data.users.length < 1000) break;
      }
      return null;
    };

    const contarAdmins = async () => {
      const { count } = await admin.from('usuarios').select('email', { count: 'exact', head: true }).eq('papel', 'admin');
      return count ?? 0;
    };

    if (acao === 'criar') {
      if (!PAPEIS.includes(papel)) return responder({ erro: 'Papel inválido.' }, 400);
      if (String(senha ?? '').length < 6) return responder({ erro: 'A senha precisa ter pelo menos 6 caracteres.' }, 400);

      const { error } = await admin.auth.admin.createUser({ email: alvo, password: senha, email_confirm: true });
      if (error && !/already|registered|exists/i.test(error.message)) return responder({ erro: error.message }, 400);
      // se a conta já existia no painel, só registra o papel (a senha dela continua a mesma)
      const { error: erroLinha } = await admin.from('usuarios').upsert({ email: alvo, papel });
      if (erroLinha) return responder({ erro: erroLinha.message }, 400);
      return responder({ ok: true, jaExistia: !!error });
    }

    if (acao === 'redefinirSenha') {
      if (String(senha ?? '').length < 6) return responder({ erro: 'A senha precisa ter pelo menos 6 caracteres.' }, 400);
      const usuario = await acharUsuarioAuth();
      if (!usuario) return responder({ erro: 'Usuário não encontrado.' }, 404);
      const { error } = await admin.auth.admin.updateUserById(usuario.id, { password: senha });
      if (error) return responder({ erro: error.message }, 400);
      return responder({ ok: true });
    }

    if (acao === 'papel') {
      if (!PAPEIS.includes(papel)) return responder({ erro: 'Papel inválido.' }, 400);
      const { data: atual } = await admin.from('usuarios').select('papel').eq('email', alvo).maybeSingle();
      if (!atual) return responder({ erro: 'Usuário não encontrado.' }, 404);
      if (atual.papel === 'admin' && papel !== 'admin' && (await contarAdmins()) <= 1) {
        return responder({ erro: 'Não dá para tirar o último administrador.' }, 400);
      }
      const { error } = await admin.from('usuarios').update({ papel }).eq('email', alvo);
      if (error) return responder({ erro: error.message }, 400);
      return responder({ ok: true });
    }

    if (acao === 'excluir') {
      if (alvo === chamador) return responder({ erro: 'Você não pode excluir o próprio usuário.' }, 400);
      const { data: atual } = await admin.from('usuarios').select('papel').eq('email', alvo).maybeSingle();
      if (atual?.papel === 'admin' && (await contarAdmins()) <= 1) {
        return responder({ erro: 'Não dá para excluir o último administrador.' }, 400);
      }
      const usuario = await acharUsuarioAuth();
      if (usuario) {
        const { error } = await admin.auth.admin.deleteUser(usuario.id);
        if (error) return responder({ erro: error.message }, 400);
      }
      await admin.from('usuarios').delete().eq('email', alvo);
      return responder({ ok: true });
    }

    return responder({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return responder({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
