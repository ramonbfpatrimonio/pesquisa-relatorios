'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/store');
const { criarHandlers } = require('../src/handlers');

function montar(dialogo = {}, extra = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-h-'));
  const store = new Store({ pastaDados: path.join(raiz, 'dados'), pastaBackup: path.join(raiz, 'Backup'), seedPath: path.join(__dirname, '..', 'data', 'seed.json') }).iniciar();
  const abertas = [];
  let pastaSalva = null;
  const handlers = criarHandlers({
    store,
    dialogo,
    versao: '1.0.0-teste',
    abrirPasta: async (p) => abertas.push(p),
    salvarPastaBackup: (p) => { pastaSalva = p; },
    verificarAtualizacoes: async () => ({ emDesenvolvimento: true }),
    baixarAtualizacao: async () => 'baixando',
    instalarAtualizacao: () => 'instalando',
    ...extra,
  });
  return { raiz, store, handlers, abertas, pasta: () => pastaSalva };
}

test('a lista de ações do preload é exatamente a dos handlers', () => {
  const { handlers } = montar();
  const texto = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const bloco = texto.slice(texto.indexOf('const ACOES = ['), texto.indexOf('];', texto.indexOf('const ACOES = [')));
  const nomes = [...bloco.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(nomes, Object.keys(handlers).sort());
});

test('erros viram { ok: false, erro } e sucesso vira { ok: true, dados }', async () => {
  const { handlers } = montar();
  const ruim = await handlers.salvarRelatorio({ nome: '', modulo: 'ATIVO_ADM' });
  assert.equal(ruim.ok, false);
  assert.match(ruim.erro, /nome/);
  const bom = await handlers.carregar();
  assert.equal(bom.ok, true);
  assert.equal(bom.dados.db.relatorios.length, 841);
  assert.equal(bom.dados.info.versao, '1.0.0-teste');
  assert.equal(bom.dados.info.totalRelatorios, 841);
});

test('cancelar uma janela de arquivo devolve null e não muda nada', async () => {
  const cancela = async () => null;
  const { handlers, store } = montar({ abrirImagem: cancela, abrirPastaImagens: cancela, escolherPastaBackup: cancela, abrirJSON: cancela, salvarJSON: cancela, salvarCSV: cancela });
  const antes = store.db.atualizadoEm;
  for (const nome of ['anexarImagem', 'importarImagensDePasta', 'escolherPastaBackup', 'exportarJSON', 'importarJSON', 'exportarCSV']) {
    const r = await handlers[nome](store.db.relatorios[0].id);
    assert.deepEqual(r, { ok: true, dados: null }, nome);
  }
  assert.equal(store.db.atualizadoEm, antes);
});

test('exportarCSV grava com BOM para o Excel; escolherPastaBackup guarda a configuração', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-c-'));
  const destino = path.join(raiz, 'saida.csv');
  const novaPasta = path.join(raiz, 'MeusBackups');
  const { handlers, pasta } = montar({ salvarCSV: async () => destino, escolherPastaBackup: async () => novaPasta });
  await handlers.exportarCSV('a;b\r\n');
  const bytes = fs.readFileSync(destino);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const r = await handlers.escolherPastaBackup();
  assert.equal(r.ok, true);
  assert.equal(r.dados.info.pastaBackup, novaPasta);
  assert.equal(pasta(), novaPasta);
});

test('abrir pastas usa as pastas do store', async () => {
  const { handlers, store, abertas } = montar();
  await handlers.abrirPastaBackup();
  await handlers.abrirPastaDados();
  assert.deepEqual(abertas, [store.pastaBackup, store.pastaDados]);
});

test('atualizações: os três handlers repassam para as funções do main.js', async () => {
  let baixou = false;
  let instalou = false;
  const { handlers } = montar({}, {
    verificarAtualizacoes: async () => ({ emDesenvolvimento: false }),
    baixarAtualizacao: async () => { baixou = true; },
    instalarAtualizacao: () => { instalou = true; },
  });
  const r1 = await handlers.verificarAtualizacoes();
  assert.deepEqual(r1, { ok: true, dados: { emDesenvolvimento: false } });
  await handlers.baixarAtualizacao();
  assert.equal(baixou, true);
  await handlers.instalarAtualizacao();
  assert.equal(instalou, true);
});

test('atualizações: erro em uma delas vira { ok: false } como qualquer outro handler', async () => {
  const { handlers } = montar({}, {
    baixarAtualizacao: async () => { throw new Error('sem internet'); },
  });
  const r = await handlers.baixarAtualizacao();
  assert.deepEqual(r, { ok: false, erro: 'sem internet' });
});

test('lerRelatoriosCSV lê o arquivo escolhido (e detecta Latin-1 quando não é UTF-8)', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-csv-'));
  const utf8 = path.join(raiz, 'utf8.csv');
  fs.writeFileSync(utf8, 'MODULO;NOME;COLUNAS\nATIVO_ADM;Relatório de Depósito;"A;B"\n', 'utf8');
  const { handlers: h1 } = montar({ abrirCSV: async () => utf8 });
  const r1 = await h1.lerRelatoriosCSV();
  assert.equal(r1.ok, true);
  assert.equal(r1.dados.nomeArquivo, 'utf8.csv');
  assert.match(r1.dados.conteudo, /Relatório de Depósito/);

  const latin1 = path.join(raiz, 'latin1.csv');
  fs.writeFileSync(latin1, Buffer.from('MODULO;NOME;COLUNAS\nATIVO_ADM;Relatório de Depósito;"A;B"\n', 'latin1'));
  const { handlers: h2 } = montar({ abrirCSV: async () => latin1 });
  const r2 = await h2.lerRelatoriosCSV();
  assert.equal(r2.ok, true);
  assert.match(r2.dados.conteudo, /Relatório de Depósito/);
});

test('lerRelatoriosCSV devolve null quando a pessoa cancela a janela', async () => {
  const { handlers } = montar({ abrirCSV: async () => null });
  const r = await handlers.lerRelatoriosCSV();
  assert.deepEqual(r, { ok: true, dados: null });
});

test('importarRelatoriosCSV repassa as linhas prontas para o store', async () => {
  const { handlers, store } = montar();
  const r = await handlers.importarRelatoriosCSV([{ modulo: 'ATIVO_ECD', nome: 'Do CSV', colunas: ['A', 'B'] }]);
  assert.equal(r.ok, true);
  assert.equal(r.dados.novos, 1);
  assert.ok(store.db.relatorios.some((x) => x.nome === 'Do CSV'));
});

test('baixarModeloRelatoriosCSV grava um arquivo de exemplo que a própria planilha aceita', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-modelo-'));
  const destino = path.join(raiz, 'modelo.csv');
  const { handlers } = montar({ salvarCSV: async () => destino });
  const r = await handlers.baixarModeloRelatoriosCSV();
  assert.equal(r.ok, true);
  assert.equal(r.dados, destino);
  const Csv = require('../src/csv');
  const analise = Csv.analisarCSV(fs.readFileSync(destino, 'utf8'));
  assert.equal(analise.ok, true);
  assert.equal(analise.linhas.length, 2);
});
