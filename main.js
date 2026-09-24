'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { Store } = require('./src/store');
const { criarHandlers } = require('./src/handlers');

const emDesenvolvimento = process.argv.includes('--dev');
const INTERVALO_BACKUP_MS = 10 * 60 * 1000;

let janela = null;
let store = null;
let temporizadorBackup = null;

// Pasta fixa e sem acento: o Electron descarta o nome do app no caminho padrão quando ele tem acento
// ("Pesquisa de Relatórios"), e os dados acabariam soltos na raiz de AppData.
app.setPath('userData', process.env.PESQUISA_RELATORIOS_USERDATA || path.join(app.getPath('appData'), 'PesquisaRelatorios'));

// Um único processo por vez: dois programas gravando o mesmo arquivo corromperiam os dados.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  });
  app.whenReady().then(iniciar);
}

// ---------- configuração (pasta de backup escolhida pelo usuário) ----------

const arquivoConfig = () => path.join(app.getPath('userData'), 'config.json');

function lerConfig() {
  try {
    return JSON.parse(fs.readFileSync(arquivoConfig(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function salvarPastaBackup(pasta) {
  fs.mkdirSync(path.dirname(arquivoConfig()), { recursive: true });
  fs.writeFileSync(arquivoConfig(), JSON.stringify({ ...lerConfig(), pastaBackup: pasta }, null, 2));
}

function pastaBackupPadrao() {
  return path.join(app.getPath('documents'), 'Pesquisa de Relatorios', 'Backup');
}

// ---------- janelas de arquivo ----------

const dialogo = {
  async abrirImagem() {
    const r = await dialog.showOpenDialog(janela, {
      title: 'Escolha a imagem da tela de filtro',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['gif', 'png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  },
  async abrirPastaImagens() {
    const r = await dialog.showOpenDialog(janela, { title: 'Escolha a pasta com as imagens', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  async escolherPastaBackup() {
    const r = await dialog.showOpenDialog(janela, { title: 'Escolha a pasta de backup', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  async abrirJSON() {
    const r = await dialog.showOpenDialog(janela, {
      title: 'Importar dados',
      properties: ['openFile'],
      filters: [{ name: 'Dados (JSON)', extensions: ['json'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  },
  async salvarJSON(nomeSugerido) {
    const r = await dialog.showSaveDialog(janela, {
      title: 'Exportar dados',
      defaultPath: nomeSugerido,
      filters: [{ name: 'Dados (JSON)', extensions: ['json'] }],
    });
    return r.canceled ? null : r.filePath;
  },
  async salvarCSV(nomeSugerido) {
    const r = await dialog.showSaveDialog(janela, {
      title: 'Exportar resultado da pesquisa',
      defaultPath: nomeSugerido,
      filters: [{ name: 'Planilha CSV', extensions: ['csv'] }],
    });
    return r.canceled ? null : r.filePath;
  },
};

// ---------- atualização automática (GitHub Releases) ----------

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function enviarParaJanela(canal, dados) {
  if (janela && !janela.isDestroyed()) janela.webContents.send(canal, dados);
}

autoUpdater.on('update-available', (info) => enviarParaJanela('atualizacao:evento', { tipo: 'disponivel', versao: info.version }));
autoUpdater.on('update-not-available', () => enviarParaJanela('atualizacao:evento', { tipo: 'nenhuma' }));
autoUpdater.on('download-progress', (p) => enviarParaJanela('atualizacao:evento', { tipo: 'progresso', percentual: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', () => enviarParaJanela('atualizacao:evento', { tipo: 'baixada' }));
autoUpdater.on('error', (erro) => enviarParaJanela('atualizacao:evento', { tipo: 'erro', mensagem: erro && erro.message ? erro.message : String(erro) }));

// Fora do app instalado (npm start/--dev) não há update.yml publicado: o autoUpdater erraria sozinho.
async function verificarAtualizacoes() {
  if (!app.isPackaged) return { emDesenvolvimento: true };
  await autoUpdater.checkForUpdates();
  return { emDesenvolvimento: false };
}
function baixarAtualizacao() {
  if (!app.isPackaged) throw new Error('Atualização automática só funciona no programa instalado, não no modo de desenvolvimento.');
  return autoUpdater.downloadUpdate();
}
function instalarAtualizacao() {
  autoUpdater.quitAndInstall();
}



function iniciar() {
  Menu.setApplicationMenu(null);

  try {
    store = new Store({
      pastaDados: path.join(app.getPath('userData'), 'dados'),
      pastaBackup: lerConfig().pastaBackup || pastaBackupPadrao(),
      seedPath: path.join(__dirname, 'data', 'seed.json'),
    }).iniciar();
  } catch (erro) {
    dialog.showErrorBox('Não foi possível abrir os dados', `${erro.message}\n\nPasta de dados: ${path.join(app.getPath('userData'), 'dados')}`);
    app.quit();
    return;
  }

  const handlers = criarHandlers({
    store,
    dialogo,
    versao: app.getVersion(),
    salvarPastaBackup,
    abrirPasta: async (pasta) => {
      const erro = await shell.openPath(pasta);
      if (erro) throw new Error('Não foi possível abrir a pasta: ' + erro);
      return true;
    },
    verificarAtualizacoes,
    baixarAtualizacao,
    instalarAtualizacao,
  });
  for (const [nome, fn] of Object.entries(handlers)) ipcMain.handle('api:' + nome, (_evento, ...args) => fn(...args));

  criarJanela();

  // Checa por atualização uma vez ao abrir (silenciosamente: sem internet ou já atualizado, não incomoda).
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
  }

  // Backup automático: ao abrir (feito no iniciar), a cada 10 minutos se algo mudou, e ao fechar.
  temporizadorBackup = setInterval(() => {
    try {
      store.backupSeMudou('auto');
    } catch (_) {
      /* tenta de novo no próximo ciclo */
    }
  }, INTERVALO_BACKUP_MS);
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1000,
    minHeight: 620,
    title: 'Pesquisa de Relatórios',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#11181c' : '#eef1f2',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  janela.once('ready-to-show', () => janela.show());
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.webContents.on('will-navigate', (e) => e.preventDefault());
  janela.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (emDesenvolvimento) janela.webContents.openDevTools({ mode: 'detach' });
  janela.on('closed', () => {
    janela = null;
  });
}

app.on('before-quit', () => {
  clearInterval(temporizadorBackup);
  try {
    if (store) store.backupSeMudou('auto');
  } catch (_) {
    /* não impede de fechar */
  }
});

app.on('window-all-closed', () => app.quit());
