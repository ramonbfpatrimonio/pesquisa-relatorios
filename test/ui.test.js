'use strict';
/*
 * Teste de ponta a ponta da interface: carrega renderer/index.html num DOM simulado (jsdom),
 * liga a tela aos handlers reais e ao Store real (em pasta temporária) e usa a tela como uma pessoa usaria.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');
const { Store } = require('../src/store');
const { criarHandlers } = require('../src/handlers');
const B = require('../src/busca');

async function esperar(fn, ms = 3000) {
  const fim = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > fim) throw new Error('Tempo esgotado esperando: ' + fn.toString());
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function abrirApp(dialogo = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-ui-'));
  const store = new Store({ pastaDados: path.join(raiz, 'dados'), pastaBackup: path.join(raiz, 'Backup'), seedPath: path.join(__dirname, '..', 'data', 'seed.json') }).iniciar();
  const handlers = criarHandlers({
    store,
    dialogo,
    versao: 'teste',
    abrirPasta: async () => true,
    salvarPastaBackup() {},
    verificarAtualizacoes: async () => ({ emDesenvolvimento: true }),
    baixarAtualizacao: async () => {},
    instalarAtualizacao: () => {},
  });
  const dom = await JSDOM.fromFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.api = handlers;
      // simula o push de eventos de atualização que, no app de verdade, vem do preload/main.js
      window.api.aoAtualizar = (ouvinte) => { window.__ouvinteAtualizacao = ouvinte; };
    },
  });
  const w = dom.window;
  const doc = w.document;
  await esperar(() => doc.querySelector('.pesquisa'));

  const api = {
    dom, w, doc, store, raiz,
    todos: (sel, raizEl = doc) => [...raizEl.querySelectorAll(sel)],
    botao(texto, raizEl = doc) {
      return [...raizEl.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(texto));
    },
    clicar(el) {
      assert.ok(el, 'elemento para clicar não encontrado');
      el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    tecla(el, key) {
      el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    },
    digitar(el, texto) {
      el.focus();
      el.value = texto;
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
    },
    // Escolhe uma coluna no campo de colunas como o usuário faria: digita e aperta Enter.
    escolherColuna(picker, nome) {
      const entrada = picker.querySelector('input');
      api.digitar(entrada, nome);
      api.tecla(entrada, 'Enter');
    },
    async aba(nome) {
      let botao = api.botao(nome, doc.querySelector('#abas'));
      if (!botao) await api.destravarMenu(); // menu protegido: aparece só depois da senha
      botao = api.botao(nome, doc.querySelector('#abas'));
      api.clicar(botao);
    },
    async destravarMenu(senha = '@t1v0ERP10') {
      doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await esperar(() => api.modal());
      api.digitar(api.modal().querySelector('#campo-senha'), senha);
      api.clicar(api.botao('Liberar', api.modal()));
      await esperar(() => !api.modal());
    },
    // Os grupos de resultado começam recolhidos: abre todos clicando na seta de cada um.
    abrirGrupos() {
      for (;;) {
        const fechado = api.todos('.grupo-cabecalho').find((c) => c.getAttribute('aria-expanded') === 'false');
        if (!fechado) break;
        api.clicar(fechado);
      }
    },
    modal: () => doc.querySelector('.modal'),
    dispararAtualizacao(dados) {
      assert.ok(w.__ouvinteAtualizacao, 'app.js precisa ter chamado window.api.aoAtualizar');
      w.__ouvinteAtualizacao(dados);
    },
    fechar: () => dom.window.close(),
  };
  return api;
}

test('abre na aba Pesquisar com o menu protegido escondido e a lista de colunas mais usadas', async () => {
  const a = await abrirApp();
  assert.deepEqual(a.todos('#abas button').map((b) => b.textContent), ['Pesquisar']);
  assert.equal(a.doc.querySelector('#abas [aria-current="page"]').textContent, 'Pesquisar');
  const segmentos = a.todos('.segmentos button').map((b) => b.textContent);
  assert.deepEqual(segmentos, ['Todos841', 'ATIVO_ADM90', 'ATIVO_LOG339', 'ATIVO_LOG_EFD13', 'ATIVO_INT159', 'ATIVO_COM201', 'ATIVO_COM_EFD18', 'ATIVO_WMS21', 'ATIVO_ECD0']);
  assert.match(a.doc.querySelector('.vazio-pesquisa h1').textContent, /Quais colunas/);
  assert.equal(a.todos('.vazio-pesquisa .chip').length, 18);
  a.fechar();
});

test('mostra a versão do app no canto inferior esquerdo da barra lateral', async () => {
  const a = await abrirApp();
  assert.equal(a.doc.querySelector('#versao-app').firstChild.textContent, 'vteste');
  a.fechar();
});

test('ícone de novidades ao lado da versão mostra o texto de data/novidades.txt', async () => {
  const a = await abrirApp();
  const icone = a.doc.querySelector('#versao-app .rel-ajuda');
  assert.ok(icone, 'deve ter o ícone de novidades (data/novidades.txt tem texto)');
  const esperado = fs.readFileSync(path.join(__dirname, '..', 'data', 'novidades.txt'), 'utf8').trim();
  icone.dispatchEvent(new a.w.Event('mouseenter'));
  assert.equal(a.doc.querySelector('.dica-flutuante').textContent, esperado);
  a.fechar();
});

test('lista de módulos é recolhível e começa fechada', async () => {
  const a = await abrirApp();
  const cabecalho = a.doc.querySelector('.modulo-cabecalho');
  assert.equal(cabecalho.getAttribute('aria-expanded'), 'false');
  assert.equal(a.doc.querySelector('.segmentos').hidden, true);

  a.clicar(cabecalho);
  assert.equal(a.doc.querySelector('.modulo-cabecalho').getAttribute('aria-expanded'), 'true');
  assert.equal(a.doc.querySelector('.segmentos').hidden, false);

  a.clicar(a.doc.querySelector('.modulo-cabecalho'));
  assert.equal(a.doc.querySelector('.modulo-cabecalho').getAttribute('aria-expanded'), 'false');
  assert.equal(a.doc.querySelector('.segmentos').hidden, true);
  a.fechar();
});

test('escolher um módulo fecha a lista sozinho e mostra o escolhido na caixa', async () => {
  const a = await abrirApp();
  const cabecalho = () => a.doc.querySelector('.modulo-cabecalho');
  assert.match(cabecalho().textContent, /^Todos/); // começa em "Todos" (estado.modulo = '*')

  a.clicar(cabecalho());
  assert.equal(a.doc.querySelector('.segmentos').hidden, false);
  a.clicar(a.botao('ATIVO_LOG', a.doc.querySelector('.segmentos')));

  assert.equal(a.doc.querySelector('.segmentos').hidden, true, 'a lista fecha sozinha ao escolher');
  assert.equal(cabecalho().getAttribute('aria-expanded'), 'false');
  assert.match(cabecalho().textContent, /^ATIVO_LOG/, 'a caixa mostra o módulo escolhido');
  a.fechar();
});

test('pesquisa por colunas mostra o mesmo resultado que a lógica de busca, agrupado por acertos', async () => {
  const a = await abrirApp();
  const picker = a.doc.querySelector('.picker');
  a.escolherColuna(picker, 'VENCIMENTO');
  a.escolherColuna(picker, 'BANCO');
  a.escolherColuna(picker, 'CHEQUE');

  assert.deepEqual(a.todos('.picker .chip.editavel').map((c) => c.firstChild.textContent), ['VENCIMENTO', 'BANCO', 'CHEQUE']);
  const esperado = B.pesquisar(a.store.db.relatorios, { modulo: '*', colunas: ['VENCIMENTO', 'BANCO', 'CHEQUE'] });
  assert.ok(esperado.total > 0);
  assert.equal(a.todos('.grupo').length, esperado.grupos.length);
  assert.deepEqual(
    a.todos('.grupo .placar').map((p) => p.textContent),
    esperado.grupos.map((g) => `${g.acertos}/3`)
  );
  // os grupos começam todos recolhidos
  const cabecalhos = a.todos('.grupo-cabecalho');
  assert.ok(cabecalhos.every((c) => c.getAttribute('aria-expanded') === 'false'));
  assert.equal(a.todos('.rel').length, 0);

  // abre o primeiro grupo (melhor resultado) e confirma que só os itens dele aparecem
  a.clicar(cabecalhos[0]);
  assert.equal(a.todos('.rel').length, esperado.grupos[0].itens.length);
  // as colunas escolhidas aparecem destacadas nos relatórios
  const primeiro = a.doc.querySelector('.rel');
  assert.ok(primeiro.querySelectorAll('.chip.hit').length >= 1);
  // relatório com tudo aparece primeiro e tem o título de "todas as 3 colunas" se existir
  if (esperado.grupos[0].acertos === 3) assert.match(a.doc.querySelector('.resultados h1').textContent, /todas as 3 colunas/);

  // abre todos os grupos pela seta e confirma que a soma bate com o total da busca
  a.abrirGrupos();
  assert.equal(a.todos('.rel').length, esperado.total);

  // as colunas de cada relatório aparecem em ordem alfabética (escolhidas primeiro, depois o resto)
  for (const cartao of a.todos('.rel')) {
    const nomes = a.todos('.chip', cartao).map((c) => c.textContent);
    const hits = nomes.filter((n) => ['VENCIMENTO', 'BANCO', 'CHEQUE'].includes(n));
    const resto = nomes.filter((n) => !['VENCIMENTO', 'BANCO', 'CHEQUE'].includes(n));
    assert.deepEqual(hits, [...hits].sort((x, y) => x.localeCompare(y, 'pt')));
    assert.deepEqual(resto, [...resto].sort((x, y) => x.localeCompare(y, 'pt')));
  }
  a.fechar();
});

test('filtrar por módulo e abrir/fechar grupos de resultado pela seta', async () => {
  const a = await abrirApp();
  const picker = a.doc.querySelector('.picker');
  a.escolherColuna(picker, 'NF');
  a.escolherColuna(picker, 'SERIE');

  a.clicar(a.botao('ATIVO_LOG_EFD'));
  const esperado = B.pesquisar(a.store.db.relatorios, { modulo: 'ATIVO_LOG_EFD', colunas: ['NF', 'SERIE'] });
  assert.ok(a.todos('.rel-modulo').every((m) => m.textContent === 'ATIVO_LOG_EFD'));

  const cabecalhos = a.todos('.grupo-cabecalho');
  assert.ok(cabecalhos.length >= 2, 'esse cenário precisa ter mais de um grupo para o teste fazer sentido');
  // todos os grupos começam recolhidos
  assert.ok(cabecalhos.every((c) => c.getAttribute('aria-expanded') === 'false'));
  assert.equal(a.todos('.rel').length, 0);

  // abre o primeiro grupo
  a.clicar(a.todos('.grupo-cabecalho')[0]);
  assert.equal(a.todos('.grupo-cabecalho')[0].getAttribute('aria-expanded'), 'true');
  assert.equal(a.todos('.rel').length, esperado.grupos[0].itens.length);
  assert.ok(a.todos('.rel-modulo').every((m) => m.textContent === 'ATIVO_LOG_EFD'));

  // clicar de novo na seta do primeiro grupo fecha a lista dele
  a.clicar(a.todos('.grupo-cabecalho')[0]);
  assert.equal(a.todos('.grupo-cabecalho')[0].getAttribute('aria-expanded'), 'false');
  assert.equal(a.todos('.rel').length, 0);

  // clicar na seta do segundo grupo abre a lista dele
  a.clicar(a.todos('.grupo-cabecalho')[1]);
  assert.equal(a.todos('.grupo-cabecalho')[1].getAttribute('aria-expanded'), 'true');
  assert.equal(a.todos('.rel').length, esperado.grupos[1].itens.length);
  a.fechar();
});

test('sem resultado: mensagem clara; limpar colunas volta ao começo', async () => {
  const a = await abrirApp();
  const picker = a.doc.querySelector('.picker');
  a.escolherColuna(picker, 'NF');
  a.clicar(a.botao('ATIVO_ECD')); // módulo vazio
  assert.match(a.doc.querySelector('.resultados h1').textContent, /Nenhum relatório tem essas colunas/);
  a.clicar(a.botao('Limpar colunas'));
  assert.ok(a.doc.querySelector('.vazio-pesquisa'));
  a.fechar();
});

test('digitar no campo sugere colunas; setas e Enter escolhem; Backspace remove a última', async () => {
  const a = await abrirApp();
  const entrada = a.doc.querySelector('.picker input');
  a.digitar(entrada, 'venc');
  const opcoes = a.todos('.picker-menu li');
  assert.ok(opcoes.length > 1);
  assert.match(opcoes[0].textContent, /^VENCIMENTO/);
  a.tecla(entrada, 'ArrowDown');
  assert.equal(a.todos('.picker-menu li')[1].getAttribute('aria-selected'), 'true');
  a.tecla(entrada, 'Enter');
  assert.equal(a.todos('.picker .chip.editavel').length, 1);
  a.tecla(entrada, 'Backspace');
  assert.equal(a.todos('.picker .chip.editavel').length, 0);
  a.fechar();
});

test('menu protegido: Ctrl+Shift+B pede senha para liberar Relatórios, Colunas e Dados e backup', async () => {
  const a = await abrirApp();
  assert.deepEqual(a.todos('#abas button').map((b) => b.textContent), ['Pesquisar']);

  // senha errada não libera
  a.doc.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await esperar(() => a.modal());
  a.digitar(a.modal().querySelector('#campo-senha'), 'senha-errada');
  a.clicar(a.botao('Liberar', a.modal()));
  await esperar(() => a.doc.querySelector('.aviso.erro'));
  assert.match(a.doc.querySelector('.aviso.erro').textContent, /Senha incorreta/);
  assert.ok(!a.modal(), 'a janela fecha mesmo com senha errada');
  assert.deepEqual(a.todos('#abas button').map((b) => b.textContent), ['Pesquisar']);

  // senha certa libera os três menus
  await a.destravarMenu();
  assert.deepEqual(a.todos('#abas button').map((b) => b.textContent), ['Pesquisar', 'Relatórios', 'Colunas', 'Dados e backup']);

  // apertar de novo esconde, sem pedir senha, e volta para Pesquisar se estiver em outra aba
  await a.aba('Relatórios');
  assert.equal(a.doc.querySelector('#abas [aria-current="page"]').textContent, 'Relatórios');
  a.doc.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await esperar(() => a.todos('#abas button').length === 1);
  assert.equal(a.doc.querySelector('#abas [aria-current="page"]').textContent, 'Pesquisar');
  a.fechar();
});

test('cadastrar novo relatório com coluna nova, e recusar nome repetido', async () => {
  const a = await abrirApp();
  await a.aba('Relatórios');
  await esperar(() => a.doc.querySelector('.tabela'));
  assert.equal(a.doc.querySelector('.contagem').textContent, '841 relatórios');

  a.clicar(a.botao('Novo relatório'));
  const m = a.modal();
  assert.ok(m);
  a.digitar(m.querySelector('#campo-nome'), 'Relatório de Teste da Interface');
  m.querySelector('#campo-modulo').value = 'ATIVO_ECD';
  const picker = m.querySelector('.picker');
  a.escolherColuna(picker, 'coluna_inventada_ui');
  a.escolherColuna(picker, 'NF');
  a.clicar(a.botao('Salvar', m));
  await esperar(() => !a.modal());

  const criado = a.store.db.relatorios.find((r) => r.nome === 'Relatório de Teste da Interface');
  assert.ok(criado);
  assert.equal(criado.modulo, 'ATIVO_ECD');
  assert.deepEqual(criado.colunas, ['COLUNA_INVENTADA_UI', 'NF']);
  assert.equal(a.doc.querySelector('.contagem').textContent, '842 relatórios');

  // nome repetido no mesmo módulo
  a.clicar(a.botao('Novo relatório'));
  const m2 = a.modal();
  a.digitar(m2.querySelector('#campo-nome'), 'relatorio de teste da interface');
  m2.querySelector('#campo-modulo').value = 'ATIVO_ECD';
  a.clicar(a.botao('Salvar', m2));
  await esperar(() => a.doc.querySelector('.aviso.erro'));
  assert.match(a.doc.querySelector('.aviso.erro').textContent, /Já existe/);
  assert.ok(a.modal(), 'a janela continua aberta para corrigir');
  assert.equal(a.store.db.relatorios.length, 842);
  a.fechar();
});

test('texto digitado e não confirmado no campo de colunas bloqueia o salvar', async () => {
  const a = await abrirApp();
  await a.aba('Relatórios');
  a.clicar(a.botao('Novo relatório'));
  const m = a.modal();
  a.digitar(m.querySelector('#campo-nome'), 'Com texto pendente');
  a.digitar(m.querySelector('.picker input'), 'ABC');
  a.clicar(a.botao('Salvar', m));
  await esperar(() => a.doc.querySelector('.aviso.erro'));
  assert.match(a.doc.querySelector('.aviso.erro').textContent, /não adicionou/);
  assert.equal(a.store.db.relatorios.length, 841);
  a.fechar();
});

test('editar e excluir relatório existente', async () => {
  const a = await abrirApp();
  await a.aba('Relatórios');
  const alvo = a.store.db.relatorios.find((r) => r.nome === 'Cheques por Cliente/Vencimento');
  assert.ok(alvo);
  const totalAntes = alvo.colunas.length; // "alvo" é o próprio objeto do banco: guardamos o número antes de salvar
  a.clicar(a.todos('.tabela button.link').find((b) => b.textContent === alvo.nome));
  const m = a.modal();
  assert.equal(m.querySelector('#campo-nome').value, alvo.nome);
  const chips = a.todos('.chip.editavel', m);
  assert.equal(chips.length, totalAntes);
  a.clicar(chips[0].querySelector('button')); // remove a primeira coluna
  a.clicar(a.botao('Salvar', m));
  await esperar(() => !a.modal());
  assert.equal(a.store.db.relatorios.find((r) => r.id === alvo.id).colunas.length, totalAntes - 1);

  a.clicar(a.todos('.tabela button.link').find((b) => b.textContent === alvo.nome));
  a.clicar(a.botao('Excluir relatório', a.modal()));
  await esperar(() => a.todos('.modal').length === 2);
  a.clicar(a.botao('Excluir', a.todos('.modal')[1]));
  await esperar(() => !a.modal());
  assert.ok(!a.store.db.relatorios.some((r) => r.id === alvo.id));
  a.fechar();
});

test('módulos: criar e excluir quando vazio', async () => {
  const a = await abrirApp();
  await a.aba('Relatórios');
  a.clicar(a.botao('Novo módulo'));
  a.digitar(a.modal().querySelector('input'), 'ativo pdv');
  a.clicar(a.botao('Continuar', a.modal()));
  await esperar(() => a.store.db.modulos.includes('ativo_pdv'));
  await esperar(() => !a.modal());
  const sel = a.doc.querySelector('.barra select');
  sel.value = 'ativo_pdv';
  sel.dispatchEvent(new a.w.Event('change', { bubbles: true }));
  a.clicar(a.botao('Excluir módulo ativo_pdv'));
  await esperar(() => a.modal());
  a.clicar(a.botao('Excluir módulo', a.modal()));
  await esperar(() => !a.store.db.modulos.includes('ativo_pdv'));
  a.fechar();
});

test('aba Colunas: nomes parecidos são listados e a unificação vale para todos os relatórios', async () => {
  const a = await abrirApp();
  await a.aba('Colunas');
  const pares = a.todos('.par');
  assert.ok(pares.length >= 5, 'a planilha original tem vários erros de digitação');
  const parFamila = pares.find((p) => p.textContent.includes('FAMILA'));
  assert.ok(parFamila);
  assert.match(parFamila.textContent, /Unificar em FAMILIA/);
  const antes = a.store.db.relatorios.filter((r) => r.colunas.includes('FAMILA')).length;
  assert.ok(antes >= 1);

  a.clicar(a.botao('Unificar em FAMILIA', parFamila));
  await esperar(() => a.modal());
  assert.match(a.modal().textContent, /Trocar FAMILA por FAMILIA/);
  a.clicar(a.botao('Unificar', a.modal()));
  await esperar(() => !a.store.db.relatorios.some((r) => r.colunas.includes('FAMILA')));
  await esperar(() => !a.todos('.par').some((p) => p.textContent.includes('FAMILA')));
  a.fechar();
});

test('aba Colunas: renomear e "Ver relatórios" leva à pesquisa com a coluna escolhida', async () => {
  const a = await abrirApp();
  await a.aba('Colunas');
  const linha = a.todos('.tabela tbody tr').find((tr) => tr.firstChild.textContent === 'VOLUME');
  assert.ok(linha);
  a.clicar(a.botao('Ver relatórios', linha));
  assert.equal(a.doc.querySelector('#abas [aria-current="page"]').textContent, 'Pesquisar');
  assert.deepEqual(a.todos('.picker .chip.editavel').map((c) => c.firstChild.textContent), ['VOLUME']);
  a.abrirGrupos();
  assert.equal(a.todos('.rel').length, a.store.db.relatorios.filter((r) => r.colunas.includes('VOLUME')).length);
  a.fechar();
});

test('imagens: anexar pela tela e ver na pesquisa', async () => {
  const raiz0 = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-img-'));
  const arquivo = path.join(raiz0, 'filtro.gif');
  fs.writeFileSync(arquivo, Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
  const a = await abrirApp({ abrirImagem: async () => arquivo });
  await a.aba('Relatórios');
  const alvo = a.store.db.relatorios.find((r) => r.imagemOriginal);
  a.clicar(a.todos('.tabela button.link').find((b) => b.textContent === alvo.nome));
  a.clicar(a.botao('Anexar imagem', a.modal()));
  await esperar(() => a.doc.querySelector('.modal img.previa'));
  assert.ok(a.store.db.relatorios.find((r) => r.id === alvo.id).imagem);
  a.clicar(a.botao('Cancelar', a.modal()));
  await esperar(() => !a.modal());

  await a.aba('Pesquisar');
  a.escolherColuna(a.doc.querySelector('.picker'), alvo.colunas[0]);
  a.abrirGrupos();
  const botaoVer = a.botao('Ver tela do filtro');
  assert.ok(botaoVer);
  a.clicar(botaoVer);
  await esperar(() => a.doc.querySelector('.modal img.previa'));
  assert.match(a.doc.querySelector('.modal img.previa').src, /^data:image\/gif/);
  a.fechar();
});

test('funcionalidade: o campo do modal salva e o ícone de interrogação mostra o texto no resultado', async () => {
  const a = await abrirApp();
  await a.aba('Relatórios');
  await esperar(() => a.doc.querySelector('.tabela'));

  // relatório COM funcionalidade
  a.clicar(a.botao('Novo relatório'));
  let m = a.modal();
  a.digitar(m.querySelector('#campo-nome'), 'Relatório Com Função');
  m.querySelector('#campo-modulo').value = 'ATIVO_ECD';
  a.escolherColuna(m.querySelector('.picker'), 'coluna_func_teste');
  a.digitar(m.querySelector('#campo-funcionalidade'), '  Mostra   os cheques do cliente.  ');
  a.clicar(a.botao('Salvar', m));
  await esperar(() => !a.modal());
  assert.equal(a.store.db.relatorios.find((r) => r.nome === 'Relatório Com Função').funcionalidade, 'Mostra os cheques do cliente.');

  // relatório SEM funcionalidade (campo deixado em branco)
  a.clicar(a.botao('Novo relatório'));
  m = a.modal();
  a.digitar(m.querySelector('#campo-nome'), 'Relatório Sem Função');
  m.querySelector('#campo-modulo').value = 'ATIVO_ECD';
  a.escolherColuna(m.querySelector('.picker'), 'coluna_sem_func_teste');
  a.clicar(a.botao('Salvar', m));
  await esperar(() => !a.modal());
  assert.equal(a.store.db.relatorios.find((r) => r.nome === 'Relatório Sem Função').funcionalidade, null);

  await a.aba('Pesquisar');
  a.escolherColuna(a.doc.querySelector('.picker'), 'coluna_func_teste');
  a.abrirGrupos();
  await esperar(() => a.doc.querySelector('.rel'));
  const icone = a.doc.querySelector('.resultados .rel-ajuda');
  assert.ok(icone, 'deve ter o ícone de interrogação');
  assert.equal(icone.getAttribute('title'), null, 'não deve usar o tooltip nativo do navegador');
  icone.dispatchEvent(new a.w.Event('mouseenter'));
  const balao = a.doc.querySelector('.dica-flutuante');
  assert.ok(balao && !balao.hidden, 'a caixa de dica deve aparecer ao passar o mouse');
  assert.equal(balao.textContent, 'Mostra os cheques do cliente.');
  icone.dispatchEvent(new a.w.Event('mouseleave'));
  assert.ok(a.doc.querySelector('.dica-flutuante').hidden, 'a caixa de dica deve sumir ao tirar o mouse');

  a.clicar(a.botao('Limpar colunas'));
  a.escolherColuna(a.doc.querySelector('.picker'), 'coluna_sem_func_teste');
  a.abrirGrupos();
  await esperar(() => a.doc.querySelector('.rel'));
  assert.ok(!a.doc.querySelector('.resultados .rel-ajuda'), 'sem funcionalidade não deve ter o ícone');
  a.fechar();
});

test('editar relatório existente carrega a funcionalidade já salva no campo do modal', async () => {
  const a = await abrirApp();
  a.store.salvarRelatorio({ nome: 'Relatório Editável', modulo: 'ATIVO_ECD', colunas: ['X'], funcionalidade: 'Texto original.' });
  await a.aba('Relatórios');
  a.digitar(a.doc.querySelector('.barra input[type="search"]'), 'Relatório Editável');
  await esperar(() => a.botao('Relatório Editável'));
  a.clicar(a.botao('Relatório Editável'));
  const m = a.modal();
  assert.equal(m.querySelector('#campo-funcionalidade').value, 'Texto original.');
  a.fechar();
});

test('aba Dados: mostra caminhos, faz backup manual e restaura', async () => {
  const a = await abrirApp();
  await a.aba('Dados e backup');
  await esperar(() => a.doc.querySelector('.tabela'));
  assert.ok(a.doc.body.textContent.includes(a.store.pastaDados));
  assert.ok(a.doc.body.textContent.includes(a.store.pastaBackup));
  const antes = a.todos('.tabela tbody tr').length;
  a.clicar(a.botao('Fazer backup agora'));
  await esperar(() => a.todos('.tabela tbody tr').length === antes + 1);

  // altera algo, restaura o backup manual e confere
  a.store.adicionarModulo('SO_DEPOIS');
  const linhaManual = a.todos('.tabela tbody tr').find((tr) => tr.textContent.includes('Manual'));
  a.clicar(a.botao('Restaurar', linhaManual));
  await esperar(() => a.modal());
  a.clicar(a.botao('Restaurar', a.modal()));
  await esperar(() => !a.store.db.modulos.includes('SO_DEPOIS'));
  a.fechar();
});

test('atualização: banner aparece quando há versão nova, atualiza com o progresso e muda ao terminar de baixar', async () => {
  const a = await abrirApp();
  assert.equal(a.doc.querySelector('#banner-atualizacao').hidden, true);

  a.dispararAtualizacao({ tipo: 'disponivel', versao: '1.2.0' });
  const banner = a.doc.querySelector('#banner-atualizacao');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /1\.2\.0/);
  assert.ok(a.botao('Baixar agora', banner));

  a.dispararAtualizacao({ tipo: 'progresso', percentual: 42 });
  assert.match(a.doc.querySelector('#banner-atualizacao').textContent, /42%/);

  a.dispararAtualizacao({ tipo: 'baixada' });
  const banner2 = a.doc.querySelector('#banner-atualizacao');
  assert.equal(banner2.hidden, false);
  assert.match(banner2.textContent, /Reinicie/);
  assert.ok(a.botao('Reiniciar agora', banner2));

  a.clicar(a.botao('Depois', banner2));
  assert.equal(a.doc.querySelector('#banner-atualizacao').hidden, true);
  a.fechar();
});

test('atualização: sem versão nova ou com erro, não incomoda com banner', async () => {
  const a = await abrirApp();
  a.dispararAtualizacao({ tipo: 'nenhuma' });
  assert.equal(a.doc.querySelector('#banner-atualizacao').hidden, true);
  a.dispararAtualizacao({ tipo: 'erro', mensagem: 'sem internet' });
  assert.equal(a.doc.querySelector('#banner-atualizacao').hidden, true);
  a.fechar();
});

test('atualização: botão manual na aba Dados avisa quando é modo de desenvolvimento', async () => {
  const a = await abrirApp();
  await a.aba('Dados e backup');
  await esperar(() => a.botao('Verificar atualizações'));
  a.clicar(a.botao('Verificar atualizações'));
  await esperar(() => a.todos('.aviso').some((el) => /modo de desenvolvimento/.test(el.textContent)));
  a.fechar();
});

test('nomes de coluna com HTML aparecem como texto, nunca como código', async () => {
  const a = await abrirApp();
  a.store.salvarRelatorio({ nome: 'Teste XSS', modulo: 'ATIVO_ECD', colunas: ['<IMG SRC=X ONERROR=ALERT(1)>'] });
  await a.aba('Relatórios');
  await a.aba('Pesquisar');
  const picker = a.doc.querySelector('.picker');
  a.escolherColuna(picker, 'IMG SRC');
  a.abrirGrupos();
  assert.equal(a.doc.querySelectorAll('.resultados img').length, 0);
  assert.ok(a.doc.querySelector('.rel .chip').textContent.includes('<IMG SRC=X'));
  a.fechar();
});

test('importar relatórios por CSV: guia de formato, prévia com novo/atualiza/erro/duplicata, e importação de verdade', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-csv-ui-'));
  const arquivo = path.join(raiz, 'lote.csv');

  const a = await abrirApp({ abrirCSV: async () => arquivo });
  const existente = a.store.db.relatorios[0]; // vai virar "atualiza"

  const conteudo =
    'MODULO;NOME;FUNCIONALIDADE;COLUNAS\n' +
    'ATIVO_TESTE_CSV;Relatorio Novo;Primeira versão da linha.;"COL_A;COL_B"\n' +
    'ATIVO_TESTE_CSV;Relatorio Novo;Segunda versão (essa que vale).;"COL_C"\n' +
    'ATIVO_ECD;;;"COL_X"\n' +
    `${existente.modulo};${existente.nome};Atualizado pelo CSV.;"COL_ATUALIZADA"\n`;
  fs.writeFileSync(arquivo, conteudo, 'utf8');

  await a.aba('Dados e backup');
  await esperar(() => a.botao('Importar relatórios (CSV)'));
  a.clicar(a.botao('Importar relatórios (CSV)'));
  await esperar(() => a.modal());
  assert.match(a.modal().textContent, /MODULO/);
  assert.match(a.modal().textContent, /COLUNAS/);

  a.clicar(a.botao('Escolher arquivo…', a.modal()));
  await esperar(() => a.modal() && /Confirmar importação/.test(a.modal().textContent));

  const modal = a.modal();
  // 2 novos (o "Relatorio Novo" que venceu a duplicata + a atualização não conta aqui), 1 atualizado, 1 com erro, 1 módulo novo
  assert.match(modal.textContent, /duplicata|mesmo relatório/i, 'deve avisar sobre a linha duplicada no arquivo');
  const linhas = a.todos('tbody tr', modal);
  assert.equal(linhas.length, 3); // a linha 2 (duplicada, substituída) não aparece na tabela
  assert.ok(!modal.textContent.includes('Primeira versão da linha'));

  const botaoImportar = [...modal.querySelectorAll('.btn')].find((b) => /^Importar \d+/.test(b.textContent));
  assert.ok(botaoImportar, 'botão de importar deve mostrar a quantidade válida (2)');
  assert.match(botaoImportar.textContent, /^Importar 2/);

  a.clicar(botaoImportar);
  await esperar(() => !a.modal());

  assert.ok(a.store.db.modulos.includes('ATIVO_TESTE_CSV'));
  const criado = a.store.db.relatorios.find((r) => r.nome === 'Relatorio Novo');
  assert.ok(criado);
  assert.deepEqual(criado.colunas, ['COL_C']); // a versão que "venceu" foi a segunda linha
  assert.equal(criado.funcionalidade, 'Segunda versão (essa que vale).');

  const atualizado = a.store.db.relatorios.find((r) => r.id === existente.id);
  assert.deepEqual(atualizado.colunas, ['COL_ATUALIZADA']);
  assert.equal(atualizado.funcionalidade, 'Atualizado pelo CSV.');

  assert.equal(a.store.db.relatorios.some((r) => !r.nome), false); // a linha com erro (sem nome) não foi importada
  a.fechar();
});

test('importar relatórios por CSV: arquivo com cabeçalho errado mostra aviso e não abre a prévia', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-csv-erro-'));
  const arquivo = path.join(raiz, 'ruim.csv');
  fs.writeFileSync(arquivo, 'A,B,C\n1,2,3\n', 'utf8');

  const a = await abrirApp({ abrirCSV: async () => arquivo });
  await a.aba('Dados e backup');
  await esperar(() => a.botao('Importar relatórios (CSV)'));
  a.clicar(a.botao('Importar relatórios (CSV)'));
  await esperar(() => a.modal());
  a.clicar(a.botao('Escolher arquivo…', a.modal()));
  await esperar(() => a.doc.querySelector('.aviso.erro'));
  assert.match(a.doc.querySelector('.aviso.erro').textContent, /MODULO/);
  assert.ok(!a.modal(), 'não deve abrir a prévia com o cabeçalho errado');
  a.fechar();
});

test('importar relatórios por CSV: botão "Baixar modelo" chama a ação certa', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-csv-modelo-'));
  const destino = path.join(raiz, 'modelo.csv');
  const a = await abrirApp({ salvarCSV: async () => destino });
  await a.aba('Dados e backup');
  await esperar(() => a.botao('Importar relatórios (CSV)'));
  a.clicar(a.botao('Importar relatórios (CSV)'));
  await esperar(() => a.modal());
  a.clicar(a.botao('Baixar modelo (.csv)', a.modal()));
  await esperar(() => fs.existsSync(destino));
  assert.match(fs.readFileSync(destino, 'utf8'), /MODULO;NOME;FUNCIONALIDADE;COLUNAS/);
  a.fechar();
});
