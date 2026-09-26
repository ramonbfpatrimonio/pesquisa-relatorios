'use strict';
/*
 * Ações que a tela pode pedir ao sistema. Ficam aqui (e não no main.js) para poderem
 * ser testadas sem abrir o Electron: as janelas de arquivo entram pelo parâmetro "dialogo".
 *
 * Todo handler devolve { ok: true, dados } ou { ok: false, erro }.
 */
const fs = require('fs');
const path = require('path');

// Excel no Brasil às vezes salva CSV como "ANSI" (Windows-1252), não UTF-8. Lemos como UTF-8
// primeiro; se aparecer o caractere de "isso não deu certo" (�), tentamos de novo como Latin-1,
// que cobre bem os acentos do português nesse caso.
function lerTextoDetectandoCodificacao(caminho) {
  const buffer = fs.readFileSync(caminho);
  const comoUtf8 = buffer.toString('utf8');
  if (!comoUtf8.includes('\ufffd')) return comoUtf8;
  return buffer.toString('latin1');
}

const MODELO_CSV_RELATORIOS =
  '\ufeff' +
  'MODULO;NOME;FUNCIONALIDADE;COLUNAS;FILTROS\r\n' +
  'ATIVO_LOG;Vendas por Vendedor;Mostra o total vendido por cada vendedor no período.;"VENDEDOR;VALOR;DATA;CLIENTE";"Vendedor:texto;Periodo:periodo"\r\n' +
  'ATIVO_ADM;Cheques Pendentes;;"CHEQUE;BANCO;VENCIMENTO";"Cliente:texto;Emissao:periodo;Situacao:lista:Aberto,Compensado,Devolvido,Descontado,Garantia,Resgatado"\r\n';

function criarHandlers({ store, dialogo, abrirPasta, salvarPastaBackup, versao, verificarAtualizacoes, baixarAtualizacao, instalarAtualizacao }) {
  // Texto de "o que mudou" dessa versão, editado à mão em data/novidades.txt antes de publicar.
  // Cada build carrega o texto que estava lá naquele momento — versões antigas instaladas mantêm o texto delas.
  function lerNovidades() {
    try {
      const texto = fs.readFileSync(path.join(__dirname, '..', 'data', 'novidades.txt'), 'utf8').trim();
      return texto || null;
    } catch (_) {
      return null;
    }
  }

  const uteis = () => ({
    db: store.db,
    info: { ...store.resumo(), versao, avisoInicial: store.avisoInicial, novidades: lerNovidades() },
  });

  const acoes = {
    carregar: () => uteis(),

    salvarRelatorio: (rel) => store.salvarRelatorio(rel),
    excluirRelatorio: (id) => store.excluirRelatorio(id),
    adicionarModulo: (nome) => store.adicionarModulo(nome),
    excluirModulo: (nome) => store.excluirModulo(nome),
    definirModulosOcultos: (nomes) => store.definirModulosOcultos(nomes),
    renomearColuna: (de, para) => store.renomearColuna(de, para),
    renomearFiltro: (de, para) => store.renomearFiltro(de, para),
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

    lerRelatoriosCSV: async () => {
      const caminho = await dialogo.abrirCSV();
      if (!caminho) return null;
      return { conteudo: lerTextoDetectandoCodificacao(caminho), nomeArquivo: path.basename(caminho) };
    },
    importarRelatoriosCSV: (linhas) => store.importarRelatoriosEmLote(linhas),
    baixarModeloRelatoriosCSV: async () => {
      const destino = await dialogo.salvarCSV('modelo-relatorios.csv');
      if (!destino) return null;
      fs.writeFileSync(destino, MODELO_CSV_RELATORIOS, 'utf8');
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
