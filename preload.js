'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Precisa ter os mesmos nomes de src/handlers.js (o teste "preload" confere).
const ACOES = [
  'carregar',
  'salvarRelatorio',
  'excluirRelatorio',
  'adicionarModulo',
  'excluirModulo',
  'definirModulosOcultos',
  'renomearColuna',
  'ignorarSimilar',
  'obterImagem',
  'removerImagem',
  'anexarImagem',
  'importarImagensDePasta',
  'listarBackups',
  'criarBackup',
  'restaurarBackup',
  'abrirPastaBackup',
  'abrirPastaDados',
  'escolherPastaBackup',
  'exportarJSON',
  'importarJSON',
  'exportarCSV',
  'lerRelatoriosCSV',
  'importarRelatoriosCSV',
  'baixarModeloRelatoriosCSV',
  'verificarAtualizacoes',
  'baixarAtualizacao',
  'instalarAtualizacao',
];

const api = {};
for (const nome of ACOES) api[nome] = (...args) => ipcRenderer.invoke('api:' + nome, ...args);

// Eventos que o processo principal empurra (não são pedidos pela tela): avisos de atualização disponível/baixada.
api.aoAtualizar = (ouvinte) => ipcRenderer.on('atualizacao:evento', (_evento, dados) => ouvinte(dados));

contextBridge.exposeInMainWorld('api', api);
