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

test('imagens: cada relatório tem a do relatório e a do filtro, independentes; trocar, espelhar no backup, remover e restaurar', () => {
  const { raiz, store } = novoStore();
  const id = store.db.relatorios[0].id;
  const rel = () => store.db.relatorios.find((r) => r.id === id);

  store.anexarImagem(id, imagemFalsa(raiz, 'a.gif')); // sem tipo = imagem do relatório
  assert.match(rel().imagem, new RegExp(`^${id}-r-.*\\.gif$`));
  assert.equal(rel().imagemFiltro, null, 'a do filtro não é afetada');
  assert.match(store.obterImagem(id), /^data:image\/gif;base64,/);
  assert.equal(store.obterImagem(id, 'filtro'), null);

  store.anexarImagem(id, imagemFalsa(raiz, 'f.png'), 'filtro');
  assert.match(rel().imagemFiltro, new RegExp(`^${id}-f-.*\\.png$`));
  assert.match(store.obterImagem(id, 'filtro'), /^data:image\/png;base64,/);
  assert.match(rel().imagem, /\.gif$/, 'a do relatório continua a mesma');

  // trocar de formato apaga o arquivo antigo, só daquele tipo
  const antigo = rel().imagem;
  store.anexarImagem(id, imagemFalsa(raiz, 'b.png'), 'relatorio');
  assert.notEqual(rel().imagem, antigo);
  assert.ok(!fs.existsSync(path.join(store.pastaImagens, antigo)));
  assert.ok(fs.existsSync(path.join(store.pastaImagens, rel().imagemFiltro)));

  const nomeBackup = store.criarBackup('manual');
  assert.ok(fs.existsSync(path.join(store.pastaBackup, 'imagens', rel().imagem)));
  assert.ok(fs.existsSync(path.join(store.pastaBackup, 'imagens', rel().imagemFiltro)));

  fs.unlinkSync(path.join(store.pastaImagens, rel().imagem));
  fs.unlinkSync(path.join(store.pastaImagens, rel().imagemFiltro));
  assert.equal(store.obterImagem(id), null);
  assert.equal(store.obterImagem(id, 'filtro'), null);
  store.restaurarBackup(nomeBackup);
  assert.match(store.obterImagem(id), /^data:image\/png/);
  assert.match(store.obterImagem(id, 'filtro'), /^data:image\/png/);

  assert.throws(() => store.anexarImagem(id, path.join(raiz, 'x.exe')), /Formato/);
  assert.throws(() => store.anexarImagem(id, imagemFalsa(raiz, 'c.png'), 'outro'), /Tipo de imagem/);
  store.removerImagem(id, 'filtro');
  assert.equal(rel().imagemFiltro, null);
  assert.ok(rel().imagem, 'remover a do filtro não mexe na do relatório');
  store.removerImagem(id);
  assert.equal(rel().imagem, null);
});

test('excluir um relatório apaga os arquivos das duas imagens', () => {
  const { raiz, store } = novoStore();
  store.salvarRelatorio({ nome: 'Com Duas Imagens', modulo: 'ATIVO_ECD', colunas: ['A'] });
  const rel = store.db.relatorios.find((r) => r.nome === 'Com Duas Imagens');
  store.anexarImagem(rel.id, imagemFalsa(raiz, 'a.gif'));
  store.anexarImagem(rel.id, imagemFalsa(raiz, 'b.gif'), 'filtro');
  const [a1, a2] = [rel.imagem, rel.imagemFiltro];
  store.excluirRelatorio(rel.id);
  assert.ok(!fs.existsSync(path.join(store.pastaImagens, a1)));
  assert.ok(!fs.existsSync(path.join(store.pastaImagens, a2)));
});

test('importarImagensDePasta liga os arquivos pelo nome que a planilha apontava, como imagem do FILTRO', () => {
  const { raiz, store } = novoStore();
  const pasta = path.join(raiz, 'IMAGENS');
  fs.mkdirSync(pasta);
  const alvo = store.db.relatorios.find((r) => r.imagemOriginal);
  assert.ok(alvo);
  // nome com caixa e espaços diferentes
  fs.writeFileSync(path.join(pasta, alvo.imagemOriginal.toUpperCase().replace(/\.GIF$/, ' .gif')), 'GIF89a');
  const r = store.importarImagensDePasta(pasta);
  assert.equal(r.associadas, 1);
  const depois = store.db.relatorios.find((x) => x.id === alvo.id);
  assert.ok(depois.imagemFiltro, 'vira imagem do filtro');
  assert.equal(depois.imagem, null, 'a imagem do relatório não é tocada');
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

test('primeira instalação: todos os módulos começam desmarcados e a escolha fica salva; instalação antiga não é afetada', () => {
  const { store } = novoStore();
  assert.deepEqual([...store.db.modulosOcultos].sort(), [...store.db.modulos].sort(), 'tudo desmarcado');
  assert.equal(store.db.modulosEscolhidos, false);

  store.definirModulosOcultos(['ATIVO_LOG', 'ATIVO_LOG', 'NAO_EXISTE', 'ATIVO_WMS']);
  assert.deepEqual(store.db.modulosOcultos.sort(), ['ATIVO_LOG', 'ATIVO_WMS']); // dedupe e ignora módulo inexistente
  assert.equal(store.db.modulosEscolhidos, true);

  const reaberto = new Store({ pastaDados: store.pastaDados, pastaBackup: store.pastaBackup, seedPath: path.join(__dirname, '..', 'data', 'seed.json') }).iniciar();
  assert.deepEqual(reaberto.db.modulosOcultos.sort(), ['ATIVO_LOG', 'ATIVO_WMS']);
  assert.equal(reaberto.db.modulosEscolhidos, true);
});

test('quem já tinha o programa (arquivo de dados sem o campo novo) mantém as marcações e não vê a escolha inicial', () => {
  const { store } = novoStore();
  fs.writeFileSync(
    path.join(store.pastaDados, 'relatorios.json'),
    JSON.stringify({ versao: 1, modulos: ['A', 'B'], relatorios: [], ignorados: [], modulosOcultos: ['B'] })
  );
  const reaberto = new Store({ pastaDados: store.pastaDados, pastaBackup: store.pastaBackup, seedPath: path.join(__dirname, '..', 'data', 'seed.json') }).iniciar();
  assert.equal(reaberto.db.modulosEscolhidos, true);
  assert.deepEqual(reaberto.db.modulosOcultos, ['B']);
});

test('excluirModulo tira o módulo excluído da lista de ocultos também', () => {
  const { store } = novoStore();
  store.adicionarModulo('SO_PRA_ESCONDER');
  store.definirModulosOcultos(['SO_PRA_ESCONDER']);
  store.excluirModulo('SO_PRA_ESCONDER');
  assert.ok(!store.db.modulosOcultos.includes('SO_PRA_ESCONDER'));
});

test('renomearFiltro troca o nome em todos os relatórios que o têm, mantendo tipo/opções de cada um', () => {
  const { store } = novoStore();
  store.salvarRelatorio({ nome: 'Rel A', modulo: 'ATIVO_ECD', colunas: ['A'], filtros: [{ nome: 'Situacao', tipo: 'lista', opcoes: ['X', 'Y'] }] });
  store.salvarRelatorio({ nome: 'Rel B', modulo: 'ATIVO_ADM', colunas: ['A'], filtros: [{ nome: 'situacao', tipo: 'texto' }] }); // caixa diferente
  store.salvarRelatorio({ nome: 'Rel C', modulo: 'ATIVO_ADM', colunas: ['A'], filtros: [{ nome: 'Cliente', tipo: 'texto' }] }); // não tem esse filtro

  const r = store.renomearFiltro('Situacao', 'Status');
  assert.equal(r.alterados, 2);
  assert.deepEqual(store.db.relatorios.find((x) => x.nome === 'Rel A').filtros, [{ nome: 'Status', tipo: 'lista', opcoes: ['X', 'Y'] }]);
  assert.deepEqual(store.db.relatorios.find((x) => x.nome === 'Rel B').filtros, [{ nome: 'Status', tipo: 'texto' }]);
  assert.deepEqual(store.db.relatorios.find((x) => x.nome === 'Rel C').filtros, [{ nome: 'Cliente', tipo: 'texto' }]); // intocado

  assert.throws(() => store.renomearFiltro('Nao Existe', 'X'), /não encontrado/);
  assert.throws(() => store.renomearFiltro('Status', '  '), /novo nome/);
});

test('renomearFiltro: se o novo nome já existir no mesmo relatório, os dois viram um só', () => {
  const { store } = novoStore();
  store.salvarRelatorio({
    nome: 'Rel Com Dois',
    modulo: 'ATIVO_ECD',
    colunas: ['A'],
    filtros: [
      { nome: 'Cliente', tipo: 'texto' },
      { nome: 'Comprador', tipo: 'texto' },
    ],
  });
  store.renomearFiltro('Comprador', 'Cliente');
  assert.deepEqual(store.db.relatorios.find((x) => x.nome === 'Rel Com Dois').filtros, [{ nome: 'Cliente', tipo: 'texto' }]);
});

test('salvarRelatorio grava e valida os filtros: tipo desconhecido vira texto, sem nome some, opções só em lista', () => {
  const { store } = novoStore();
  store.salvarRelatorio({
    nome: 'Com Filtros',
    modulo: 'ATIVO_ECD',
    colunas: ['A'],
    filtros: [
      { nome: 'Cliente', tipo: 'texto' },
      { nome: '  ', tipo: 'texto' }, // sem nome, some
      { nome: 'Data Emissao', tipo: 'tipo-inventado' }, // vira texto
      { nome: 'Situacao', tipo: 'lista', opcoes: ['Aberto', 'Aberto', ' Fechado '] },
      { nome: 'Cliente', tipo: 'numero' }, // nome repetido, ignora a segunda
    ],
  });
  const criado = store.db.relatorios.find((r) => r.nome === 'Com Filtros');
  assert.deepEqual(criado.filtros, [
    { nome: 'Cliente', tipo: 'texto' },
    { nome: 'Data Emissao', tipo: 'texto' },
    { nome: 'Situacao', tipo: 'lista', opcoes: ['Aberto', 'Fechado'] },
  ]);

  // relatório sem filtros vira lista vazia, não undefined
  store.salvarRelatorio({ nome: 'Sem Filtros', modulo: 'ATIVO_ECD', colunas: ['A'] });
  assert.deepEqual(store.db.relatorios.find((r) => r.nome === 'Sem Filtros').filtros, []);
});

test('importarRelatoriosEmLote grava os filtros de cada linha', () => {
  const { store } = novoStore();
  const r = store.importarRelatoriosEmLote([
    { modulo: 'ATIVO_ECD', nome: 'Via Lote', colunas: ['A'], filtros: [{ nome: 'Cliente', tipo: 'texto' }] },
  ]);
  assert.equal(r.novos, 1);
  assert.deepEqual(store.db.relatorios.find((x) => x.nome === 'Via Lote').filtros, [{ nome: 'Cliente', tipo: 'texto' }]);
});

test('importarRelatoriosEmLote ao atualizar: só mexe nos filtros que vieram na planilha, o resto do que já existia continua', () => {
  const { store } = novoStore();
  store.salvarRelatorio({
    nome: 'Relatorio Existente',
    modulo: 'ATIVO_ECD',
    colunas: ['A'],
    filtros: [
      { nome: 'Cliente', tipo: 'texto' },
      { nome: 'Situacao', tipo: 'lista', opcoes: ['Aberto', 'Fechado'] },
    ],
  });

  // reimporta só mencionando LOCAL_DE_ARMAZENAGEM (novo) e Situacao (atualiza as opções) — sem Cliente
  store.importarRelatoriosEmLote([
    {
      modulo: 'ATIVO_ECD',
      nome: 'Relatorio Existente',
      colunas: ['A', 'B'],
      filtros: [
        { nome: 'LOCAL_DE_ARMAZENAGEM', tipo: 'texto' },
        { nome: 'Situacao', tipo: 'lista', opcoes: ['Aberto', 'Compensado', 'Devolvido'] },
      ],
    },
  ]);

  const atualizado = store.db.relatorios.find((r) => r.nome === 'Relatorio Existente');
  assert.deepEqual(atualizado.filtros, [
    { nome: 'Cliente', tipo: 'texto' }, // não foi mencionado no CSV, continua igual
    { nome: 'Situacao', tipo: 'lista', opcoes: ['Aberto', 'Compensado', 'Devolvido'] }, // atualizado
    { nome: 'LOCAL_DE_ARMAZENAGEM', tipo: 'texto' }, // novo, adicionado
  ]);
});

test('importarRelatoriosEmLote: célula FILTROS vazia na planilha não apaga os filtros que já existiam', () => {
  const { store } = novoStore();
  store.salvarRelatorio({ nome: 'Com Filtro', modulo: 'ATIVO_ECD', colunas: ['A'], filtros: [{ nome: 'Cliente', tipo: 'texto' }] });
  store.importarRelatoriosEmLote([{ modulo: 'ATIVO_ECD', nome: 'Com Filtro', colunas: ['A', 'B'] }]); // sem "filtros" na linha
  assert.deepEqual(store.db.relatorios.find((r) => r.nome === 'Com Filtro').filtros, [{ nome: 'Cliente', tipo: 'texto' }]);
});

test('validarBanco aceita um relatório já com filtros salvos (ex.: vindo de backup antigo)', () => {
  const { store } = novoStore();
  fs.writeFileSync(
    path.join(store.pastaDados, 'relatorios.json'),
    JSON.stringify({
      versao: 1,
      modulos: ['ATIVO_ECD'],
      relatorios: [{ id: 'r1', modulo: 'ATIVO_ECD', nome: 'X', colunas: ['A'], filtros: [{ nome: 'Cliente', tipo: 'texto' }] }],
      ignorados: [],
    })
  );
  const reaberto = new Store({ pastaDados: store.pastaDados, pastaBackup: store.pastaBackup, seedPath: path.join(__dirname, '..', 'data', 'seed.json') }).iniciar();
  assert.deepEqual(reaberto.db.relatorios[0].filtros, [{ nome: 'Cliente', tipo: 'texto' }]);
});

test('criarColuna: cadastra solta, aparece na lista mesmo sem estar em relatório, e recusa duplicata', () => {
  const { store } = novoStore();
  store.criarColuna('  nova   coluna teste  ');
  assert.ok(store.db.colunasCadastradas.includes('NOVA COLUNA TESTE'));

  assert.throws(() => store.criarColuna('Nova Coluna Teste'), /já existe/); // mesma, caixa diferente
  assert.throws(() => store.criarColuna('   '), /nome da coluna/);
  assert.throws(() => store.criarColuna('VALOR'), /já existe/); // já usada em algum relatório do seed
});

test('criarFiltro: cadastra solto (com tipo/opções), e recusa duplicata pelo nome', () => {
  const { store } = novoStore();
  store.criarFiltro({ nome: 'Situacao', tipo: 'lista', opcoes: ['Aberto', 'Fechado'] });
  assert.deepEqual(store.db.filtrosCadastrados, [{ nome: 'Situacao', tipo: 'lista', opcoes: ['Aberto', 'Fechado'] }]);

  assert.throws(() => store.criarFiltro({ nome: 'situacao', tipo: 'texto' }), /já existe/);
  assert.throws(() => store.criarFiltro({ nome: '' }), /nome do filtro/);

  store.salvarRelatorio({ nome: 'Rel', modulo: 'ATIVO_ECD', colunas: ['A'], filtros: [{ nome: 'Cliente', tipo: 'texto' }] });
  assert.throws(() => store.criarFiltro({ nome: 'Cliente' }), /já existe/); // já usado em relatório, mesmo não estando "cadastrado"
});

test('colunasCadastradas e filtrosCadastrados sobrevivem a reabrir o programa', () => {
  const { store } = novoStore();
  store.criarColuna('Solta');
  store.criarFiltro({ nome: 'Solto', tipo: 'texto' });
  const reaberto = new Store({ pastaDados: store.pastaDados, pastaBackup: store.pastaBackup, seedPath: path.join(__dirname, '..', 'data', 'seed.json') }).iniciar();
  assert.ok(reaberto.db.colunasCadastradas.includes('SOLTA'));
  assert.deepEqual(reaberto.db.filtrosCadastrados, [{ nome: 'Solto', tipo: 'texto' }]);
});

test('renomearColuna também funciona numa coluna avulsa (0 relatórios) — bug: antes só achava dentro de relatórios', () => {
  const { store } = novoStore();
  store.criarColuna('SOLTA');
  const r = store.renomearColuna('SOLTA', 'SOLTA_NOVA');
  assert.equal(r.alterados, 0); // nenhum relatório tinha essa coluna
  assert.ok(!store.db.colunasCadastradas.includes('SOLTA'));
  assert.ok(store.db.colunasCadastradas.includes('SOLTA_NOVA'));
});

test('renomearFiltro também funciona num filtro avulso (0 relatórios) — bug: antes só achava dentro de relatórios', () => {
  const { store } = novoStore();
  store.criarFiltro({ nome: 'Grupos', tipo: 'texto' });
  const r = store.renomearFiltro('Grupos', 'Grupo');
  assert.equal(r.alterados, 0);
  assert.deepEqual(store.db.filtrosCadastrados, [{ nome: 'Grupo', tipo: 'texto' }]);
});

test('tema começa "claro" e é só deste computador (sobrevive a reabrir)', () => {
  const { store } = novoStore();
  assert.equal(store.db.tema, 'claro');
  store.definirTema('escuro');
  assert.equal(store.db.tema, 'escuro');
  const reaberto = new Store({ pastaDados: store.pastaDados, pastaBackup: store.pastaBackup, seedPath: path.join(__dirname, '..', 'data', 'seed.json') }).iniciar();
  assert.equal(reaberto.db.tema, 'escuro');
  store.definirTema('valor-invalido');
  assert.equal(store.db.tema, 'claro'); // qualquer coisa que não seja "escuro" vira "claro"
});
