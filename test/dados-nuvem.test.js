'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dbParaLinhas, linhasParaDb, diffLinhas } = require('../src/dados-nuvem');

function dbExemplo() {
  return {
    modulos: ['ATIVO_ADM', 'ATIVO_LOG'],
    relatorios: [
      {
        id: 'r1',
        modulo: 'ATIVO_ADM',
        nome: 'Rel 1',
        colunas: ['A', 'B'],
        filtros: [{ nome: 'Cliente', tipo: 'texto' }],
        funcionalidade: 'Serve pra isso.',
        imagem: 'r1-r-abc.png',
        imagemOriginal: 'planilha.gif',
        imagemFiltro: null,
      },
    ],
    colunasCadastradas: ['SOLTA'],
    filtrosCadastrados: [{ nome: 'Situacao', tipo: 'lista', opcoes: ['Aberto', 'Fechado'] }],
    ignorados: ['A|B'],
    modulosOcultos: ['ATIVO_LOG'], // preferência local — não deve ir pra nuvem
    modulosEscolhidos: true, // idem
  };
}

test('dbParaLinhas -> linhasParaDb: ida e volta preserva os dados que vão pra nuvem', () => {
  const db = dbExemplo();
  const linhas = dbParaLinhas(db);
  assert.deepEqual(linhas.modulos, [{ nome: 'ATIVO_ADM', ordem: 0 }, { nome: 'ATIVO_LOG', ordem: 1 }]);
  assert.equal(linhas.relatorios[0].imagem_original, 'planilha.gif');
  assert.equal(linhas.relatorios[0].imagem_filtro, null);

  const reconstruido = linhasParaDb(linhas, { modulosOcultos: [], modulosEscolhidos: false });
  assert.deepEqual(reconstruido.modulos, db.modulos);
  assert.deepEqual(reconstruido.relatorios, db.relatorios);
  assert.deepEqual(reconstruido.colunasCadastradas, db.colunasCadastradas);
  assert.deepEqual(reconstruido.filtrosCadastrados, db.filtrosCadastrados);
  assert.deepEqual(reconstruido.ignorados, db.ignorados);
});

test('linhasParaDb mantém o "base" (preferências só do computador) intocado', () => {
  const linhas = dbParaLinhas(dbExemplo());
  const r = linhasParaDb(linhas, { modulosOcultos: ['X'], modulosEscolhidos: true, outraCoisaLocal: 42 });
  assert.deepEqual(r.modulosOcultos, ['X']);
  assert.equal(r.modulosEscolhidos, true);
  assert.equal(r.outraCoisaLocal, 42);
});

test('linhasParaDb com tabelas vazias/faltando não quebra', () => {
  const r = linhasParaDb({}, {});
  assert.deepEqual(r, { modulos: [], relatorios: [], colunasCadastradas: [], filtrosCadastrados: [], ignorados: [] });
});

test('filtrosCadastrados sem opções (tipo texto) não inventa o campo "opcoes"', () => {
  const linhas = dbParaLinhas({ filtrosCadastrados: [{ nome: 'Cliente', tipo: 'texto' }] });
  assert.deepEqual(linhas.filtros_cadastrados, [{ nome: 'Cliente', tipo: 'texto', opcoes: null }]);
  const r = linhasParaDb(linhas, {});
  assert.deepEqual(r.filtrosCadastrados, [{ nome: 'Cliente', tipo: 'texto' }]);
});

test('diffLinhas: nada mudou = vazio', () => {
  const linhas = dbParaLinhas(dbExemplo());
  const r = diffLinhas(linhas, linhas);
  assert.equal(r.vazio, true);
  assert.deepEqual(r.upserts, {});
  assert.deepEqual(r.deletes, {});
});

test('diffLinhas: detecta linha nova, linha alterada e linha removida, tabela por tabela', () => {
  const antes = dbParaLinhas(dbExemplo());
  const dbDepois = dbExemplo();
  dbDepois.relatorios[0].nome = 'Rel 1 (renomeado)'; // alterada
  dbDepois.relatorios.push({ id: 'r2', modulo: 'ATIVO_LOG', nome: 'Rel 2', colunas: ['C'], filtros: [], funcionalidade: null, imagem: null, imagemOriginal: null, imagemFiltro: null }); // nova
  dbDepois.colunasCadastradas = []; // removida
  const depois = dbParaLinhas(dbDepois);

  const r = diffLinhas(antes, depois);
  assert.equal(r.vazio, false);
  assert.equal(r.upserts.relatorios.length, 2);
  assert.ok(r.upserts.relatorios.some((x) => x.id === 'r1' && x.nome === 'Rel 1 (renomeado)'));
  assert.ok(r.upserts.relatorios.some((x) => x.id === 'r2'));
  assert.deepEqual(r.deletes.colunas_cadastradas, ['SOLTA']);
  assert.ok(!r.upserts.modulos, 'módulos não mudaram, não entra no diff');
});

test('diffLinhas: excluir um relatório vira delete só na tabela relatorios', () => {
  const antes = dbParaLinhas(dbExemplo());
  const dbDepois = dbExemplo();
  dbDepois.relatorios = [];
  const depois = dbParaLinhas(dbDepois);
  const r = diffLinhas(antes, depois);
  assert.deepEqual(r.deletes.relatorios, ['r1']);
  assert.ok(!r.upserts.relatorios);
});
