'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Csv = require('../src/csv');

test('analisarCSV lê separado por vírgula, com aspas e ; dentro das colunas', () => {
  const texto = 'MODULO,NOME,FUNCIONALIDADE,COLUNAS\n' + 'ATIVO_LOG,Vendas por Vendedor,Mostra o total por vendedor.,"VENDEDOR;VALOR;DATA"\n';
  const r = Csv.analisarCSV(texto);
  assert.equal(r.ok, true);
  assert.equal(r.separador, ',');
  assert.equal(r.linhas.length, 1);
  assert.deepEqual(r.linhas[0], {
    numeroLinha: 2,
    modulo: 'ATIVO_LOG',
    nome: 'Vendas por Vendedor',
    funcionalidade: 'Mostra o total por vendedor.',
    colunas: ['VENDEDOR', 'VALOR', 'DATA'],
    erros: [],
  });
});

test('analisarCSV detecta separador ; sozinho (planilha do Excel em português)', () => {
  const texto = 'MODULO;NOME;FUNCIONALIDADE;COLUNAS\n' + 'ATIVO_ADM;Cheques Pendentes;;"CHEQUE;BANCO;VENCIMENTO"\n';
  const r = Csv.analisarCSV(texto);
  assert.equal(r.ok, true);
  assert.equal(r.separador, ';');
  assert.equal(r.linhas[0].modulo, 'ATIVO_ADM');
  assert.equal(r.linhas[0].funcionalidade, null); // célula vazia vira null, não ""
  assert.deepEqual(r.linhas[0].colunas, ['CHEQUE', 'BANCO', 'VENCIMENTO']);
});

test('analisarCSV aceita cabeçalho em qualquer ordem e tira o BOM do Excel', () => {
  const texto = '\ufeffCOLUNAS;NOME;MODULO\n' + '"A;B";Teste;ATIVO_ECD\n';
  const r = Csv.analisarCSV(texto);
  assert.equal(r.ok, true);
  assert.deepEqual(r.linhas[0].colunas, ['A', 'B']);
  assert.equal(r.linhas[0].nome, 'Teste');
  assert.equal(r.linhas[0].modulo, 'ATIVO_ECD');
});

test('analisarCSV sem FUNCIONALIDADE no cabeçalho funciona (ela é opcional)', () => {
  const texto = 'MODULO,NOME,COLUNAS\n' + 'ATIVO_ECD,Teste,"X;Y"\n';
  const r = Csv.analisarCSV(texto);
  assert.equal(r.ok, true);
  assert.equal(r.linhas[0].funcionalidade, null);
});

test('analisarCSV aponta erro por linha quando falta módulo, nome ou coluna', () => {
  const texto = 'MODULO,NOME,COLUNAS\n' + ',Sem módulo,"A"\n' + 'ATIVO_ECD,,"A"\n' + 'ATIVO_ECD,Sem coluna,\n' + 'ATIVO_ECD,Linha Ok,"A;B"\n';
  const r = Csv.analisarCSV(texto);
  assert.equal(r.ok, true);
  assert.deepEqual(r.linhas[0].erros, ['faltou o módulo']);
  assert.deepEqual(r.linhas[1].erros, ['faltou o nome do relatório']);
  assert.deepEqual(r.linhas[2].erros, ['faltou pelo menos uma coluna']);
  assert.deepEqual(r.linhas[3].erros, []);
});

test('analisarCSV recusa cabeçalho sem as colunas obrigatórias', () => {
  const r = Csv.analisarCSV('MODULO,NOME\nATIVO_ECD,Teste\n');
  assert.equal(r.ok, false);
  assert.match(r.erroGeral, /COLUNAS/);
});

test('analisarCSV recusa arquivo vazio ou só com cabeçalho', () => {
  assert.equal(Csv.analisarCSV('').ok, false);
  assert.equal(Csv.analisarCSV('   \n  ').ok, false);
  const r = Csv.analisarCSV('MODULO,NOME,COLUNAS\n');
  assert.equal(r.ok, false);
  assert.match(r.erroGeral, /nenhuma linha/);
});

test('analisarCSV espaço extra no módulo vira _, e o nome do relatório perde espaços duplicados', () => {
  const texto = 'MODULO,NOME,COLUNAS\n' + 'ATIVO  COM,"Vendas   por   Dia",A\n';
  const r = Csv.analisarCSV(texto);
  assert.equal(r.linhas[0].modulo, 'ATIVO_COM');
  assert.equal(r.linhas[0].nome, 'Vendas por Dia');
});
