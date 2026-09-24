'use strict';
/*
 * Ações que a tela pode pedir ao sistema. Ficam aqui (e não no main.js) para poderem
 * ser testadas sem abrir o Electron: as janelas de arquivo entram pelo parâmetro "dialogo".
 *
 * Todo handler devolve { ok: true, dados } ou { ok: false, erro }.
 */
const fs = require('fs');

function criarHandlers({ store, dialogo, abrirPasta, salvarPastaBackup, versao, verificarAtualizacoes, baixarAtualizacao, instalarAtualizacao }) {
  const uteis = () => ({
    db: store.db,
    info: { ...store.resumo(), versao, avisoInicial: store.avisoInicial },
  });

  const acoes = {
    carregar: () => uteis(),

    salvarRelatorio: (rel) => store.salvarRelatorio(rel),
    excluirRelatorio: (id) => store.excluirRelatorio(id),
    adicionarModulo: (nome) => store.adicionarModulo(nome),
    excluirModulo: (nome) => store.excluirModulo(nome),
    renomearColuna: (de, para) => store.renomearColuna(de, para),
    ignorarSimilar: (chave) => store.ignorarSimilar(chave),

    obterImagem: (id) => store.obterImagem(id),
    removerImagem: (id) => store.removerImagem(id),
    anexarImagem: async (id) => {
      const arquivo = await dialogo.abrirImagem();
      return arquivo ? store.anexarImagem(id, arquivo) : null;
    },
    importarImagensDePasta: async () => {
      const pasta = await dialogo.abrirPastaImagens();
      return pasta ? store.importarImagensDePasta(pasta) : null;
    },

    listarBackups: () => store.listarBackups(),
    criarBackup: () => ({ nome: store.criarBackup('manual'), backups: store.listarBackups() }),
    restaurarBackup: (nome) => store.restaurarBackup(nome),
    abrirPastaBackup: () => abrirPasta(store.pastaBackup),
    abrirPastaDados: () => abrirPasta(store.pastaDados),
    escolherPastaBackup: async () => {
      const pasta = await dialogo.escolherPastaBackup();
      if (!pasta) return null;
      store.definirPastaBackup(pasta);
      salvarPastaBackup(pasta);
      return { info: uteis().info, backups: store.listarBackups() };
    },

    exportarJSON: async () => {
      const destino = await dialogo.salvarJSON('relatorios-backup.json');
      if (!destino) return null;
      store.exportarPara(destino);
      return destino;
    },
    importarJSON: async () => {
      const origem = await dialogo.abrirJSON();
      return origem ? store.importarDe(origem) : null;
    },
    exportarCSV: async (conteudo) => {
      const destino = await dialogo.salvarCSV('pesquisa-relatorios.csv');
      if (!destino) return null;
      // BOM para o Excel reconhecer os acentos.
      fs.writeFileSync(destino, '\ufeff' + String(conteudo), 'utf8');
      return destino;
    },

    verificarAtualizacoes: () => verificarAtualizacoes(),
    baixarAtualizacao: () => baixarAtualizacao(),
    instalarAtualizacao: () => instalarAtualizacao(),
  };

  const envolvidos = {};
  for (const [nome, fn] of Object.entries(acoes)) {
    envolvidos[nome] = async (...args) => {
      try {
        return { ok: true, dados: await fn(...args) };
      } catch (erro) {
        return { ok: false, erro: erro && erro.message ? erro.message : String(erro) };
      }
    };
  }
  return envolvidos;
}

module.exports = { criarHandlers };
