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
  'renomearFiltro',
  'criarColuna',
  'criarFiltro',
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
  'nuvemStatus',
  'nuvemEntrar',
  'nuvemSair',
  'nuvemEnviarTudo',
  'nuvemListarUsuarios',
  'nuvemCriarUsuario',
  'nuvemRedefinirSenhaUsuario',
  'nuvemDefinirPapel',
  'nuvemExcluirUsuario',
  'nuvemRedefinirMinhaSenha',
];

const api = {};
for (const nome of ACOES) api[nome] = (...args) => ipcRenderer.invoke('api:' + nome, ...args);

// Eventos que o processo principal empurra (não são pedidos pela tela): avisos de atualização disponível/baixada.
api.aoAtualizar = (ouvinte) => ipcRenderer.on('atualizacao:evento', (_evento, dados) => ouvinte(dados));
// Dados que chegaram da nuvem (na hora de abrir, ou em tempo real quando outro computador muda algo) e o status da conexão.
api.aoDadosNuvem = (ouvinte) => ipcRenderer.on('nuvem:dados', (_evento, dados) => ouvinte(dados));
api.aoStatusNuvem = (ouvinte) => ipcRenderer.on('nuvem:status', (_evento, status) => ouvinte(status));

contextBridge.exposeInMainWorld('api', api);
