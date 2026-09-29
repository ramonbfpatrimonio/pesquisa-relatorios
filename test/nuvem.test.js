'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Nuvem } = require('../src/nuvem');

// ---------- cliente Supabase de mentira (mesma forma do supabase-js, sem rede) ----------

function clienteFalso({ papel = 'admin', linhasIniciais = {} } = {}) {
  const banco = {
    modulos: [...(linhasIniciais.modulos || [])],
    relatorios: [...(linhasIniciais.relatorios || [])],
    colunas_cadastradas: [...(linhasIniciais.colunas_cadastradas || [])],
    filtros_cadastrados: [...(linhasIniciais.filtros_cadastrados || [])],
    ignorados: [...(linhasIniciais.ignorados || [])],
    usuarios: [{ email: 'patrimonio@patrimonio.com', papel }],
  };
  const canais = [];
  const chamadas = { upsert: [], delete: [], invoke: [] };

  function tabela(nome) {
    let filtroEq = null;
    const api = {
      select: () => api,
      eq: (campo, valor) => {
        filtroEq = { campo, valor };
        return api;
      },
      maybeSingle: async () => {
        const achado = (banco[nome] || []).find((l) => !filtroEq || l[filtroEq.campo] === filtroEq.valor);
        return { data: achado || null, error: null };
      },
      upsert: async (linhas) => {
        chamadas.upsert.push({ tabela: nome, linhas });
        const chave = nome === 'ignorados' ? 'chave' : nome === 'modulos' || nome.endsWith('_cadastradas') || nome.endsWith('_cadastrados') ? 'nome' : 'id';
        for (const linha of linhas) {
          const i = banco[nome].findIndex((l) => l[chave] === linha[chave]);
          if (i >= 0) banco[nome][i] = linha;
          else banco[nome].push(linha);
        }
        return { error: null };
      },
      delete: () => ({
        in: async (campo, valores) => {
          chamadas.delete.push({ tabela: nome, campo, valores });
          banco[nome] = banco[nome].filter((l) => !valores.includes(l[campo]));
          return { error: null };
        },
      }),
      then(resolve) {
        // permite "await cliente.from(t).select('*')" sem encadear mais nada
        resolve({ data: banco[nome] ? [...banco[nome]] : [], error: null });
      },
    };
    return api;
  }

  return {
    _banco: banco,
    _chamadas: chamadas,
    _dispararMudanca() {
      canais.forEach((c) => c._callbacks.forEach((cb) => cb()));
    },
    auth: {
      signInWithPassword: async ({ email, password }) => {
        if (email !== 'patrimonio@patrimonio.com' || password !== 'senha-certa') {
          return { data: null, error: { message: 'Invalid login credentials' } };
        }
        return { data: { session: { access_token: 'tok' }, user: { email } }, error: null };
      },
      signOut: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
    },
    from: tabela,
    channel: () => {
      const c = { _callbacks: [], on: (_tipo, _filtro, cb) => { c._callbacks.push(cb); return c; }, subscribe: () => c };
      canais.push(c);
      return c;
    },
    removeChannel: (c) => {
      const i = canais.indexOf(c);
      if (i >= 0) canais.splice(i, 1);
    },
    functions: {
      invoke: async (_nome, { body }) => {
        chamadas.invoke.push(body);
        return { data: { ok: true }, error: null };
      },
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        download: async () => ({ data: { arrayBuffer: async () => Buffer.from('conteudo-imagem') }, error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

function novaNuvem(opcoesCliente) {
  let cliente;
  const dbsRecebidos = [];
  const statusRecebidos = [];
  const nuvem = new Nuvem({
    criarCliente: () => {
      cliente = clienteFalso(opcoesCliente);
      return cliente;
    },
    aoAtualizarDados: (db) => dbsRecebidos.push(db),
    aoAtualizarStatus: (s) => statusRecebidos.push(s),
    atraso: 5,
  });
  nuvem.configurar('https://exemplo.supabase.co', 'chave-anon');
  return { nuvem, dbsRecebidos, statusRecebidos, cliente: () => cliente };
}

// a maioria dos testes já parte de "sincronização iniciada" (é automático, sem login, ao abrir o
// programa) — só os testes de login/senha chamam entrar() direto, sem isso.
async function novaNuvemSincronizada(opcoesCliente, baseLocal = {}) {
  const ctx = novaNuvem(opcoesCliente);
  await ctx.nuvem.iniciarSincronizacao(() => baseLocal);
  return ctx;
}

// ---------- testes ----------

test('configurar recusa quando a URL/chave ainda são o texto de exemplo', () => {
  const nuvem = new Nuvem({ criarCliente: () => ({}) });
  assert.throws(() => nuvem.configurar('COLE_AQUI_A_URL_DO_PROJETO', 'COLE_AQUI_A_CHAVE_ANON'), /ainda não foi configurada/);
  assert.throws(() => nuvem.configurar('', ''), /ainda não foi configurada/);
});

test('a leitura sincroniza sozinha, sem login (Pesquisar fica livre)', async () => {
  const { nuvem, dbsRecebidos } = await novaNuvemSincronizada({
    linhasIniciais: { modulos: [{ nome: 'ATIVO_ADM', ordem: 0 }], relatorios: [{ id: 'r1', modulo: 'ATIVO_ADM', nome: 'Rel 1', colunas: ['A'] }] },
  });
  assert.equal(nuvem.leituraAtiva, true);
  assert.equal(nuvem.autenticado, false);
  assert.equal(nuvem.podeEscrever(), false);
  assert.equal(dbsRecebidos.length, 1);
  assert.equal(dbsRecebidos[0].relatorios.length, 1);
});

test('nuvem vazia (ninguém migrou ainda) não apaga os dados locais — mas fica ouvindo', async () => {
  const { nuvem, dbsRecebidos, cliente } = await novaNuvemSincronizada({}, { nuvemVinculada: false });
  assert.equal(dbsRecebidos.length, 0, 'não chamou aoAtualizarDados com um banco vazio');
  assert.equal(nuvem.leituraAtiva, true, 'mesmo assim, continua conectado e ouvindo');

  cliente()._banco.relatorios.push({ id: 'x1', modulo: 'ATIVO_ADM', nome: 'Alguém migrou', colunas: ['A'] });
  cliente()._dispararMudanca();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(dbsRecebidos.length, 1, 'assim que a nuvem deixa de estar vazia, aplica sozinho');
});

test('nuvem vazia mas este computador já esteve vinculado: aplica mesmo assim (respeita ter ficado vazia)', async () => {
  const { dbsRecebidos } = await novaNuvemSincronizada({}, { nuvemVinculada: true });
  assert.equal(dbsRecebidos.length, 1);
  assert.deepEqual(dbsRecebidos[0].relatorios, []);
});

test('entrar: senha errada recusa, e a leitura continua funcionando', async () => {
  const { nuvem } = await novaNuvemSincronizada();
  await assert.rejects(() => nuvem.entrar('patrimonio@patrimonio.com', 'senha-errada'), /incorretos/);
  assert.equal(nuvem.autenticado, false);
  assert.equal(nuvem.leituraAtiva, true);
});

test('entrar: senha certa eleva pra permissão de escrita, sem reconectar nem buscar tudo de novo', async () => {
  const { nuvem, dbsRecebidos } = await novaNuvemSincronizada({ papel: 'admin' });
  const antes = dbsRecebidos.length;
  const r = await nuvem.entrar('patrimonio@patrimonio.com', 'senha-certa');
  assert.equal(r.papel, 'admin');
  assert.equal(nuvem.autenticado, true);
  assert.equal(nuvem.podeEscrever(), true);
  assert.equal(dbsRecebidos.length, antes, 'não precisou buscar tudo de novo só pra logar');
});

test('editor pode escrever, e quem não está em "usuarios" (papel nulo) não pode', async () => {
  const { nuvem } = await novaNuvemSincronizada({ papel: 'editor' });
  await nuvem.entrar('patrimonio@patrimonio.com', 'senha-certa');
  assert.equal(nuvem.podeEscrever(), true);

  const { nuvem: nuvem2 } = await novaNuvemSincronizada({ papel: null });
  await nuvem2.entrar('patrimonio@patrimonio.com', 'senha-certa');
  assert.equal(nuvem2.papel, null);
  assert.equal(nuvem2.podeEscrever(), false);
});

test('registrarMudancaLocal sem estar conectado não faz nada (app continua só local)', async () => {
  const { nuvem } = novaNuvem();
  const r = await nuvem.registrarMudancaLocal({ modulos: ['A'], relatorios: [] });
  assert.deepEqual(r, { enviado: false });
});

test('registrarMudancaLocal manda só o que mudou, e nada muda sem diff', async () => {
  const { nuvem, cliente } = await novaNuvemSincronizada();
  await nuvem.entrar('patrimonio@patrimonio.com', 'senha-certa');

  const db1 = { modulos: ['ATIVO_ADM'], relatorios: [{ id: 'r1', modulo: 'ATIVO_ADM', nome: 'Rel 1', colunas: ['A'], filtros: [], funcionalidade: null, imagem: null, imagemOriginal: null, imagemFiltro: null }] };
  const r1 = await nuvem.registrarMudancaLocal(db1);
  assert.equal(r1.enviado, true);
  assert.equal(cliente()._banco.relatorios.length, 1);
  assert.equal(cliente()._banco.modulos.length, 1);

  const r2 = await nuvem.registrarMudancaLocal(db1); // nada mudou desde a última vez
  assert.equal(r2.enviado, false);
  assert.equal(cliente()._chamadas.upsert.filter((c) => c.tabela === 'relatorios').length, 1, 'não manda de novo');

  const db2 = { ...db1, relatorios: [] }; // excluiu o relatório
  const r3 = await nuvem.registrarMudancaLocal(db2);
  assert.equal(r3.enviado, true);
  assert.equal(cliente()._banco.relatorios.length, 0);
});

test('mudança na nuvem (tempo real) chega no aoAtualizarDados, e várias mudanças juntas viram uma busca só', async () => {
  const { nuvem, dbsRecebidos, cliente } = await novaNuvemSincronizada();
  const antes = dbsRecebidos.length;

  cliente()._banco.relatorios.push({ id: 'x1', modulo: 'ATIVO_ADM', nome: 'Veio de outro pc', colunas: ['A'] });
  cliente()._dispararMudanca();
  cliente()._banco.relatorios.push({ id: 'x2', modulo: 'ATIVO_ADM', nome: 'Outro ainda', colunas: ['B'] });
  cliente()._dispararMudanca();

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(dbsRecebidos.length, antes + 1, 'as duas mudanças quase juntas viraram uma busca só');
  const ultimo = dbsRecebidos[dbsRecebidos.length - 1];
  assert.equal(ultimo.relatorios.length, 2);
});

test('sincronizarRetratoCom evita reenviar à toa depois que quem chamou normaliza o banco (ex.: store.js)', async () => {
  const { nuvem, cliente } = await novaNuvemSincronizada({
    linhasIniciais: { relatorios: [{ id: 'r1', modulo: 'ATIVO_ADM', nome: 'Rel 1', colunas: ['valor'] }] }, // minúsculo, "sujo"
  });
  await nuvem.entrar('patrimonio@patrimonio.com', 'senha-certa');

  // sem sincronizarRetratoCom, o "normalizado" (colunas maiúsculas) pareceria diferente do que
  // a nuvem tinha — e mandaria de novo à toa. Simula o que store.js faz: normaliza ao aplicar.
  const normalizado = { modulos: [], relatorios: [{ id: 'r1', modulo: 'ATIVO_ADM', nome: 'Rel 1', colunas: ['VALOR'], filtros: [], funcionalidade: null, imagem: null, imagemOriginal: null, imagemFiltro: null }] };
  nuvem.sincronizarRetratoCom(normalizado);

  const r = await nuvem.registrarMudancaLocal(normalizado); // mesmíssimo banco normalizado, nada mudou de fato
  assert.equal(r.enviado, false, 'não reenvia à toa depois de sincronizar o retrato');
  assert.equal(cliente()._chamadas.upsert.length, 0);
});

test('sair() derruba a permissão de escrita, mas a leitura em tempo real continua', async () => {
  const { nuvem, dbsRecebidos, cliente } = await novaNuvemSincronizada();
  await nuvem.entrar('patrimonio@patrimonio.com', 'senha-certa');
  const c = cliente();
  await nuvem.sair();
  assert.equal(nuvem.autenticado, false);
  assert.equal(nuvem.papel, null);
  assert.equal(nuvem.leituraAtiva, true, 'continua lendo, sem precisar de login');

  const antes = dbsRecebidos.length;
  c._banco.relatorios.push({ id: 'depois-de-sair', modulo: 'ATIVO_ADM', nome: 'Ainda chega', colunas: ['A'] });
  c._dispararMudanca();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(dbsRecebidos.length, antes + 1, 'mudança de outro computador continua chegando mesmo sem sessão de escrita');
});

test('enviarTudo: exige permissão de escrita', async () => {
  const { nuvem } = await novaNuvemSincronizada();
  await assert.rejects(() => nuvem.enviarTudo({ modulos: [], relatorios: [] }), /login/);
});

test('enviarTudo: manda o que existe aqui e apaga da nuvem o que não existe mais aqui', async () => {
  const { nuvem, cliente } = await novaNuvemSincronizada({
    linhasIniciais: { relatorios: [{ id: 'velho', modulo: 'ATIVO_ADM', nome: 'Só na nuvem', colunas: [] }] },
  });
  await nuvem.entrar('patrimonio@patrimonio.com', 'senha-certa');
  const meuDb = { modulos: [], relatorios: [{ id: 'novo', modulo: 'ATIVO_ADM', nome: 'Só aqui', colunas: ['A'], filtros: [], funcionalidade: null, imagem: null, imagemOriginal: null, imagemFiltro: null }] };
  const r = await nuvem.enviarTudo(meuDb);
  assert.equal(r.alterados, true);
  const ids = cliente()._banco.relatorios.map((x) => x.id);
  assert.deepEqual(ids, ['novo']);
});

test('status() reflete leituraAtiva/autenticado/sincronizando/erro, e aoAtualizarStatus é chamado', async () => {
  const { nuvem, statusRecebidos } = novaNuvem();
  assert.equal(nuvem.status().leituraAtiva, false);
  await nuvem.iniciarSincronizacao(() => ({}));
  assert.equal(nuvem.status().leituraAtiva, true);
  assert.equal(nuvem.status().autenticado, false);
  await nuvem.entrar('patrimonio@patrimonio.com', 'senha-certa');
  assert.equal(nuvem.status().autenticado, true);
  assert.ok(statusRecebidos.length >= 1);
});

test('gerenciar usuários chama a função do servidor com a ação certa', async () => {
  const { nuvem, cliente } = await novaNuvemSincronizada();
  await nuvem.entrar('patrimonio@patrimonio.com', 'senha-certa');
  await nuvem.criarUsuario('novo@x.com', 'abcdef', 'editor');
  await nuvem.redefinirSenhaDeUsuario('novo@x.com', 'abcdef2');
  await nuvem.definirPapelDeUsuario('novo@x.com', 'admin');
  await nuvem.excluirUsuario('novo@x.com');
  const acoes = cliente()._chamadas.invoke.map((c) => c.acao);
  assert.deepEqual(acoes, ['criar', 'redefinirSenha', 'papel', 'excluir']);
});

test('imagens: subir, baixar e apagar usam o Storage do cliente', async () => {
  const { nuvem } = await novaNuvemSincronizada();
  await nuvem.entrar('patrimonio@patrimonio.com', 'senha-certa');
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvem-img-'));
  const arquivo = path.join(raiz, 'a.gif');
  fs.writeFileSync(arquivo, 'conteudo');
  await nuvem.subirImagem(arquivo, 'r1-r-abc.gif');

  const destino = path.join(raiz, 'baixada.gif');
  await nuvem.baixarImagem('r1-r-abc.gif', destino);
  assert.equal(fs.readFileSync(destino, 'utf8'), 'conteudo-imagem');

  await nuvem.apagarImagem('r1-r-abc.gif'); // não deve lançar erro
});
