'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/busca');

const rels = [
  { id: 'a', modulo: 'ADM', nome: 'Cheques por Cliente', colunas: ['EMISSAO', 'NF', 'BANCO', 'VALOR'] },
  { id: 'b', modulo: 'ADM', nome: 'Cheques por Vencimento', colunas: ['VENCIMENTO', 'NF', 'BANCO', 'VALOR'] },
  { id: 'c', modulo: 'LOG', nome: 'Notas de Entrada', colunas: ['NF', 'FORNECEDOR', 'VALOR'] },
  { id: 'd', modulo: 'LOG', nome: 'Recibo', colunas: [] },
];

test('pesquisar agrupa pela quantidade de colunas em comum, do maior para o menor', () => {
  const r = B.pesquisar(rels, { modulo: '*', colunas: ['NF', 'BANCO', 'EMISSAO'] });
  assert.equal(r.n, 3);
  assert.deepEqual(r.grupos.map((g) => [g.acertos, g.itens.map((i) => i.rel.id)]), [[3, ['a']], [2, ['b']], [1, ['c']]]);
  assert.deepEqual(r.grupos[1].itens[0].faltam, ['EMISSAO']);
  assert.equal(r.total, 3);
});

test('pesquisar respeita o módulo e ignora relatórios sem nenhuma coluna escolhida', () => {
  const r = B.pesquisar(rels, { modulo: 'LOG', colunas: ['NF'] });
  assert.deepEqual(r.grupos.map((g) => g.itens.map((i) => i.rel.id)), [['c']]);
  assert.equal(B.pesquisar(rels, { modulo: '*', colunas: ['NAO_EXISTE'] }).total, 0);
  assert.equal(B.pesquisar(rels, { modulo: '*', colunas: [] }).total, 0);
});

test('pesquisar sugere colunas que aparecem junto nos melhores relatórios', () => {
  const r = B.pesquisar(rels, { modulo: '*', colunas: ['NF', 'BANCO'] });
  const nomes = r.sugestoes.map((s) => s.nome);
  assert.ok(nomes.includes('VALOR'));
  assert.ok(!nomes.includes('NF') && !nomes.includes('BANCO'));
});

test('sugerirColunas ordena: exata, começa com, começa palavra, contém; ignora acento e maiúscula', () => {
  const ops = [
    { nome: 'DATA_ULTIMO_PEDIDO', qtd: 1 },
    { nome: 'PEDIDO', qtd: 2 },
    { nome: 'PEDIDO_NUMERO', qtd: 9 },
    { nome: 'REPEDIDO', qtd: 5 },
    { nome: 'MÊS', qtd: 3 },
  ];
  assert.deepEqual(B.sugerirColunas(ops, 'pedido').map((o) => o.nome), ['PEDIDO', 'PEDIDO_NUMERO', 'DATA_ULTIMO_PEDIDO', 'REPEDIDO']);
  assert.deepEqual(B.sugerirColunas(ops, 'mes').map((o) => o.nome), ['MÊS']);
  assert.deepEqual(B.sugerirColunas(ops, 'pedido', new Set(['PEDIDO'])).map((o) => o.nome)[0], 'PEDIDO_NUMERO');
  assert.equal(B.sugerirColunas(ops, 'a(b').length, 0); // caracteres de regex não quebram
});

test('sugerirColunas com a caixa vazia lista em ordem alfabética, não por frequência', () => {
  const ops = [
    { nome: 'PEDIDO_NUMERO', qtd: 9 },
    { nome: 'MÊS', qtd: 3 },
    { nome: 'DATA_ULTIMO_PEDIDO', qtd: 1 },
    { nome: 'REPEDIDO', qtd: 5 },
  ];
  assert.deepEqual(B.sugerirColunas(ops, '').map((o) => o.nome), ['DATA_ULTIMO_PEDIDO', 'MÊS', 'PEDIDO_NUMERO', 'REPEDIDO']);
});

test('sugerirColunas com a caixa vazia não corta em 40, mesmo com o limite padrão do picker', () => {
  const muitas = Array.from({ length: 120 }, (_, i) => ({ nome: `COL_${String(i).padStart(3, '0')}`, qtd: 1 }));
  const r = B.sugerirColunas(muitas, '', new Set(), 40);
  assert.equal(r.length, 120);
  assert.equal(r[0].nome, 'COL_000');
  assert.equal(r[119].nome, 'COL_119');
});

test('colunasSimilares acha erros de digitação e variações, mas não QUANTIDADE_1 x QUANTIDADE_2', () => {
  const rs = [
    { colunas: ['QUANTIDADE', 'VENDA', '%_VENDA', 'FAMILIA', 'VOLUME', 'QUANTIDADE_1', 'ICMS_ST', 'CNPJ/CPF', 'VALOR'] },
    { colunas: ['FAMILIA', 'VALUME', 'QUANTIDADE_2', 'ICMSST', 'CNPJ_CPF', 'VALOR', 'MEDIA'] },
    { colunas: ['FAMILA', 'VALOR', 'VAOR', 'MEDIO'] },
    { colunas: ['VALOR'] },
    { colunas: ['VALOR'] },
    { colunas: ['VALOR'] },
  ];
  const pares = B.colunasSimilares(rs, []).map((p) => p.chave);
  assert.ok(pares.includes('FAMILA|FAMILIA'));
  assert.ok(pares.includes('VALUME|VOLUME'));
  assert.ok(pares.includes('ICMSST|ICMS_ST'));
  assert.ok(pares.includes('CNPJ/CPF|CNPJ_CPF'));
  assert.ok(pares.includes('VALOR|VAOR'), 'nome curto raro x nome comum');
  assert.ok(!pares.includes('MEDIA|MEDIO'), 'nomes curtos parecidos, mas ambos raros, não entram');
  assert.ok(!pares.some((k) => k.includes('QUANTIDADE_1')));
  assert.ok(!pares.some((k) => k.includes('QUANTIDADE|')), 'QUANTIDADE x QUANTIDADE_1 são colunas diferentes');
  assert.ok(!pares.some((k) => k.includes('%_VENDA')), '%_VENDA (percentual) não é VENDA');
  assert.ok(!B.colunasSimilares(rs, ['FAMILA|FAMILIA']).some((p) => p.chave === 'FAMILA|FAMILIA'));
});

test('gerarCSV usa ; e aspas quando preciso', () => {
  const r = B.pesquisar([{ id: 'x', modulo: 'ADM', nome: 'Relatório "A"; teste', colunas: ['NF', 'BANCO'] }], { modulo: '*', colunas: ['NF'] });
  const csv = B.gerarCSV(r, ['NF']);
  const linhas = csv.trim().split('\r\n');
  assert.equal(linhas.length, 2);
  assert.ok(linhas[1].startsWith('ADM;"Relatório ""A""; teste";1;1;;'));
});

test('limparNomeColuna padroniza espaços e caixa', () => {
  assert.equal(B.limparNomeColuna('  valor   total '), 'VALOR TOTAL');
});

test('mesclarFiltros: atualiza quem já existe (pelo nome), adiciona quem é novo, mantém quem não foi mencionado', () => {
  const existentes = [
    { nome: 'Cliente', tipo: 'texto' },
    { nome: 'Situacao', tipo: 'lista', opcoes: ['Aberto', 'Fechado'] },
  ];
  const novos = [
    { nome: 'situacao', tipo: 'lista', opcoes: ['Aberto', 'Compensado', 'Devolvido'] }, // mesmo nome (case diferente) -> atualiza
    { nome: 'Periodo', tipo: 'periodo' }, // novo -> adiciona
  ];
  const r = B.mesclarFiltros(existentes, novos);
  assert.deepEqual(r, [
    { nome: 'Cliente', tipo: 'texto' }, // não foi mencionado, continua igual
    { nome: 'situacao', tipo: 'lista', opcoes: ['Aberto', 'Compensado', 'Devolvido'] }, // atualizado
    { nome: 'Periodo', tipo: 'periodo' }, // adicionado
  ]);
});

test('mesclarFiltros: lista de novos vazia devolve os existentes sem mudar nada', () => {
  const existentes = [{ nome: 'Cliente', tipo: 'texto' }];
  assert.deepEqual(B.mesclarFiltros(existentes, []), existentes);
  assert.deepEqual(B.mesclarFiltros(undefined, []), []);
});

test('mesclarFiltros: sem filtros existentes, os novos viram a lista inteira', () => {
  const novos = [{ nome: 'Cliente', tipo: 'texto' }];
  assert.deepEqual(B.mesclarFiltros(null, novos), novos);
});
