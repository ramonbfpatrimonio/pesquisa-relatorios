'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/store');

const SEED = path.join(__dirname, '..', 'data', 'seed.json');

function novoStore() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pesq-'));
  const store = new Store({ pastaDados: path.join(raiz, 'dados'), pastaBackup: path.join(raiz, 'Backup'), seedPath: SEED });
  return { raiz, store: store.iniciar() };
}

function imagemFalsa(raiz, nome = 'tela.gif') {
  const arq = path.join(raiz, nome);
  fs.writeFileSync(arq, Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
  return arq;
}

test('primeira abertura cria as pastas, carrega os 841 relatórios da planilha e faz o primeiro backup', () => {
  const { raiz, store } = novoStore();
  assert.ok(fs.existsSync(path.join(raiz, 'dados', 'relatorios.json')));
  assert.ok(fs.existsSync(path.join(raiz, 'Backup')));
  assert.equal(store.db.relatorios.length, 841);
  assert.deepEqual(store.db.modulos, ['ATIVO_ADM', 'ATIVO_LOG', 'ATIVO_LOG_EFD', 'ATIVO_INT', 'ATIVO_COM', 'ATIVO_COM_EFD', 'ATIVO_WMS', 'ATIVO_ECD']);
  assert.equal(store.listarBackups().length, 1);
  assert.equal(store.listarBackups()[0].tipo, 'auto');
});

test('reabrir mantém as alterações e o backup automático cobre o que mudou', () => {
  const { store } = novoStore();
  store.adicionarModulo('NOVO');
  const reaberto = new Store({ pastaDados: store.pastaDados, pastaBackup: store.pastaBackup, seedPath: SEED }).iniciar();
  assert.ok(reaberto.db.modulos.includes('NOVO'));
  assert.ok(reaberto.backupSeMudou('auto'), 'a mudança ainda não tinha backup');
  assert.equal(reaberto.backupSeMudou('auto'), null, 'sem nova mudança não cria outro');
});

test('backupSeMudou só cria quando o arquivo mudou', () => {
  const { store } = novoStore();
  assert.equal(store.backupSeMudou('auto'), null);
  store.adicionarModulo('X_NOVO');
  assert.ok(store.backupSeMudou('auto'));
  assert.equal(store.backupSeMudou('auto'), null);
});

test('salvarRelatorio cria, edita, padroniza colunas e bloqueia nome repetido no módulo', () => {
  const { store } = novoStore();
  store.salvarRelatorio({ nome: '  Meu   Relatório ', modulo: 'ATIVO_ECD', colunas: ['valor', ' NF ', 'VALOR', ''] });
  const criado = store.db.relatorios.find((r) => r.nome === 'Meu Relatório');
  assert.deepEqual(criado.colunas, ['VALOR', 'NF']);
  assert.throws(() => store.salvarRelatorio({ nome: 'meu relatorio', modulo: 'ATIVO_ECD', colunas: [] }), /Já existe/);
  store.salvarRelatorio({ nome: 'meu relatorio', modulo: 'ATIVO_ADM', colunas: [] }); // outro módulo pode
  store.salvarRelatorio({ id: criado.id, nome: 'Meu Relatório 2', modulo: 'ATIVO_ECD', colunas: ['NF'] });
  assert.deepEqual(store.db.relatorios.find((r) => r.id === criado.id).colunas, ['NF']);
  assert.throws(() => store.salvarRelatorio({ nome: '', modulo: 'ATIVO_ECD' }), /nome/);
  assert.throws(() => store.salvarRelatorio({ nome: 'A', modulo: 'NAO_EXISTE' }), /módulo/);
  assert.throws(() => store.salvarRelatorio({ id: 'zzz', nome: 'A', modulo: 'ATIVO_ECD' }), /não encontrado/);
});

test('salvarRelatorio grava e edita a funcionalidade (texto livre, aparado, vazio vira null)', () => {
  const { store } = novoStore();
  store.salvarRelatorio({ nome: 'Com função', modulo: 'ATIVO_ECD', colunas: [], funcionalidade: '  Mostra   os cheques do cliente.  ' });
  let rel = store.db.relatorios.find((r) => r.nome === 'Com função');
  assert.equal(rel.funcionalidade, 'Mostra os cheques do cliente.');

  store.salvarRelatorio({ id: rel.id, nome: rel.nome, modulo: rel.modulo, colunas: [], funcionalidade: '' });
  rel = store.db.relatorios.find((r) => r.id === rel.id);
  assert.equal(rel.funcionalidade, null);

  const semFuncao = store.salvarRelatorio({ nome: 'Sem função', modulo: 'ATIVO_ECD', colunas: [] });
  assert.equal(semFuncao.relatorios.find((r) => r.nome === 'Sem função').funcionalidade, null);
});

test('excluir relatório e módulos (só módulo vazio)', () => {
  const { store } = novoStore();
  const id = store.db.relatorios[0].id;
  store.excluirRelatorio(id);
  assert.equal(store.db.relatorios.length, 840);
  assert.throws(() => store.excluirModulo('ATIVO_ADM'), /sem relatórios/);
  store.excluirModulo('ATIVO_ECD');
  assert.ok(!store.db.modulos.includes('ATIVO_ECD'));
  assert.throws(() => store.adicionarModulo('ativo_adm'), /já existe/);
});

test('renomearColuna troca em todos os relatórios e unifica quando o nome já existe', () => {
  const { store } = novoStore();
  const antes = store.db.relatorios.filter((r) => r.colunas.includes('VALUME')).length;
  assert.ok(antes >= 1);
  const { alterados } = store.renomearColuna('VALUME', 'VOLUME');
  assert.equal(alterados, antes);
  assert.equal(store.db.relatorios.filter((r) => r.colunas.includes('VALUME')).length, 0);
  // relatório com as duas colunas vira uma só
  store.salvarRelatorio({ nome: 'Teste unificar', modulo: 'ATIVO_ECD', colunas: ['FAMILA', 'FAMILIA'] });
  store.renomearColuna('FAMILA', 'FAMILIA');
  assert.deepEqual(store.db.relatorios.find((r) => r.nome === 'Teste unificar').colunas, ['FAMILIA']);
  assert.throws(() => store.renomearColuna('NAO_EXISTE', 'X'), /não encontrada/);
  assert.throws(() => store.renomearColuna('NF', '  '), /novo nome/);
});

test('backup manual, restauração e cópia de segurança antes de restaurar', () => {
  const { store } = novoStore();
  const nomeBackup = store.criarBackup('manual');
  store.adicionarModulo('DEPOIS_DO_BACKUP');
  store.restaurarBackup(nomeBackup);
  assert.ok(!store.db.modulos.includes('DEPOIS_DO_BACKUP'));
  assert.ok(store.listarBackups().some((b) => b.tipo === 'antes-de-restaurar'));
  assert.throws(() => store.restaurarBackup('../../etc/passwd'), /inválido/);
  assert.throws(() => store.restaurarBackup('dados_2020-01-01_00-00-00_auto.json'), /não existe/);
});

test('backups automáticos antigos são podados; manuais ficam', () => {
  const { store } = novoStore();
  for (let i = 0; i < 45; i++) {
    const nome = `dados_2020-01-${String((i % 28) + 1).padStart(2, '0')}_10-${String(i).padStart(2, '0')}-00_auto.json`;
    fs.copyFileSync(store.arquivoDados, path.join(store.pastaBackup, nome));
  }
  store.criarBackup('manual');
  const lista = store.listarBackups();
  assert.equal(lista.filter((b) => b.tipo === 'auto').length, 40);
  assert.equal(lista.filter((b) => b.tipo === 'manual').length, 1);
});

test('arquivo de dados corrompido é guardado à parte e restaurado do último backup', () => {
  const { store } = novoStore();
  store.adicionarModulo('SALVO_NO_BACKUP');
  store.criarBackup('manual');
  fs.writeFileSync(store.arquivoDados, '{ isso não é json');
  const de = new Store({ pastaDados: store.pastaDados, pastaBackup: store.pastaBackup, seedPath: SEED }).iniciar();
  assert.ok(de.db.modulos.includes('SALVO_NO_BACKUP'));
  assert.match(de.avisoInicial, /danificado/);
  assert.ok(fs.readdirSync(store.pastaDados).some((n) => n.startsWith('relatorios.corrompido_')));
});

test('sem backup válido, corrompido volta para a lista original', () => {
  const { store } = novoStore();
  for (const b of store.listarBackups()) fs.unlinkSync(path.join(store.pastaBackup, b.nome));
  fs.writeFileSync(store.arquivoDados, '');
  const de = new Store({ pastaDados: store.pastaDados, pastaBackup: store.pastaBackup, seedPath: SEED }).iniciar();
  assert.equal(de.db.relatorios.length, 841);
  assert.match(de.avisoInicial, /lista original/);
});

test('imagens: anexar, ler, trocar de formato, espelhar no backup, remover e restaurar do espelho', () => {
  const { raiz, store } = novoStore();
  const id = store.db.relatorios[0].id;
  store.anexarImagem(id, imagemFalsa(raiz, 'a.gif'));
  const rel = () => store.db.relatorios.find((r) => r.id === id);
  assert.equal(rel().imagem, `${id}.gif`);
  assert.match(store.obterImagem(id), /^data:image\/gif;base64,/);

  store.anexarImagem(id, imagemFalsa(raiz, 'b.png'));
  assert.equal(rel().imagem, `${id}.png`);
  assert.ok(!fs.existsSync(path.join(store.pastaImagens, `${id}.gif`)));

  const nomeBackup = store.criarBackup('manual');
  assert.ok(fs.existsSync(path.join(store.pastaBackup, 'imagens', `${id}.png`)));

  fs.unlinkSync(path.join(store.pastaImagens, `${id}.png`));
  assert.equal(store.obterImagem(id), null);
  store.restaurarBackup(nomeBackup);
  assert.match(store.obterImagem(id), /^data:image\/png/);

  assert.throws(() => store.anexarImagem(id, path.join(raiz, 'x.exe')), /Formato/);
  store.removerImagem(id);
  assert.equal(rel().imagem, null);
  assert.equal(store.obterImagem(id), null);
});

test('importarImagensDePasta liga os arquivos pelo nome que a planilha apontava', () => {
  const { raiz, store } = novoStore();
  const pasta = path.join(raiz, 'IMAGENS');
  fs.mkdirSync(pasta);
  const alvo = store.db.relatorios.find((r) => r.imagemOriginal);
  assert.ok(alvo);
  // nome com caixa e espaços diferentes
  fs.writeFileSync(path.join(pasta, alvo.imagemOriginal.toUpperCase().replace(/\.GIF$/, ' .gif')), 'GIF89a');
  const r = store.importarImagensDePasta(pasta);
  assert.equal(r.associadas, 1);
  assert.ok(store.db.relatorios.find((x) => x.id === alvo.id).imagem);
});

test('exportar e importar dados; arquivo inválido é recusado sem alterar nada', () => {
  const { raiz, store } = novoStore();
  const destino = path.join(raiz, 'export.json');
  store.exportarPara(destino);
  store.adicionarModulo('SO_NO_ATUAL');
  store.importarDe(destino);
  assert.ok(!store.db.modulos.includes('SO_NO_ATUAL'));
  assert.ok(store.listarBackups().some((b) => b.tipo === 'antes-de-importar'));

  const ruim = path.join(raiz, 'ruim.json');
  fs.writeFileSync(ruim, '{"modulos": 1}');
  assert.throws(() => store.importarDe(ruim), /inválido/);
  fs.writeFileSync(ruim, 'nao e json');
  assert.throws(() => store.importarDe(ruim), /JSON/);
  assert.equal(store.db.relatorios.length, 841);
});

test('trocar a pasta de backup cria a pasta nova e já faz um backup nela', () => {
  const { raiz, store } = novoStore();
  const nova = path.join(raiz, 'outra', 'Backup');
  store.definirPastaBackup(nova);
  assert.equal(store.pastaBackup, nova);
  assert.equal(store.listarBackups().length, 1);
  assert.ok(fs.existsSync(path.join(nova, 'imagens')));
});

test('gravação é atômica: nenhum .tmp sobra', () => {
  const { store } = novoStore();
  store.adicionarModulo('A1');
  assert.ok(!fs.readdirSync(store.pastaDados).some((n) => n.endsWith('.tmp')));
});

test('importarRelatoriosEmLote cria módulo e relatório novos, e faz backup antes', () => {
  const { store } = novoStore();
  const antes = store.listarBackups().length;
  const r = store.importarRelatoriosEmLote([
    { modulo: 'ATIVO_NOVO', nome: '  Teste   Lote  ', colunas: ['valor', 'CLIENTE', 'valor'], funcionalidade: '  Serve pra testar.  ' },
  ]);
  assert.equal(r.novosModulos, 1);
  assert.equal(r.novos, 1);
  assert.equal(r.atualizados, 0);
  assert.ok(store.db.modulos.includes('ATIVO_NOVO'));
  const criado = store.db.relatorios.find((x) => x.nome === 'Teste Lote');
  assert.ok(criado);
  assert.deepEqual(criado.colunas, ['VALOR', 'CLIENTE']);
  assert.equal(criado.funcionalidade, 'Serve pra testar.');
  assert.equal(store.listarBackups().length, antes + 1);
  assert.ok(store.listarBackups().some((b) => b.tipo === 'antes-de-importar'));
});

test('importarRelatoriosEmLote atualiza relatório existente (mesmo módulo + nome, sem diferenciar caixa)', () => {
  const { store } = novoStore();
  const alvo = store.db.relatorios[0];
  const r = store.importarRelatoriosEmLote([
    { modulo: alvo.modulo, nome: alvo.nome.toUpperCase(), colunas: ['COLUNA_ATUALIZADA'], funcionalidade: 'Nova descrição.' },
  ]);
  assert.equal(r.novos, 0);
  assert.equal(r.atualizados, 1);
  assert.equal(store.db.relatorios.length, 841); // não duplicou, só atualizou
  const atualizado = store.db.relatorios.find((x) => x.id === alvo.id);
  assert.deepEqual(atualizado.colunas, ['COLUNA_ATUALIZADA']);
  assert.equal(atualizado.funcionalidade, 'Nova descrição.');
});

test('importarRelatoriosEmLote com funcionalidade em branco mantém a que já existia', () => {
  const { store } = novoStore();
  const alvo = store.db.relatorios.find((r) => r.funcionalidade);
  const original = alvo.funcionalidade;
  store.importarRelatoriosEmLote([{ modulo: alvo.modulo, nome: alvo.nome, colunas: alvo.colunas, funcionalidade: '' }]);
  assert.equal(store.db.relatorios.find((x) => x.id === alvo.id).funcionalidade, original);
});

test('importarRelatoriosEmLote ignora linha inválida (sem quebrar as outras) e recusa lista vazia', () => {
  const { store } = novoStore();
  const r = store.importarRelatoriosEmLote([
    { modulo: '', nome: 'Sem módulo', colunas: ['A'] },
    { modulo: 'ATIVO_ECD', nome: 'Válido', colunas: ['A'] },
  ]);
  assert.equal(r.novos, 1);
  assert.ok(store.db.relatorios.some((x) => x.nome === 'Válido'));
  assert.ok(!store.db.relatorios.some((x) => x.nome === 'Sem módulo'));
  assert.throws(() => store.importarRelatoriosEmLote([]), /nada para importar/);
});
