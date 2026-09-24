'use strict';
/*
 * Armazenamento local. Sem dependências do Electron: recebe as pastas por parâmetro,
 * o que permite testar tudo com o Node puro.
 *
 *   <pastaDados>/relatorios.json      banco de dados (um arquivo JSON)
 *   <pastaDados>/imagens/             imagens das telas de filtro
 *   <pastaBackup>/dados_*.json        cópias de segurança
 *   <pastaBackup>/imagens/            espelho das imagens
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { limparNomeColuna, semAcento } = require('./busca');

const EXTENSOES_IMAGEM = { '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' };
const LIMITE_IMAGEM = 10 * 1024 * 1024;
const MAX_BACKUPS_AUTOMATICOS = 40;
const PADRAO_BACKUP = /^dados_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-z-]+\.json$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

function etiquetaData(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function hashDe(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

// Grava em arquivo temporário e troca o original: nunca deixa o arquivo pela metade.
function gravarAtomico(destino, conteudo) {
  const tmp = destino + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, conteudo);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, destino);
}

function unicos(lista) {
  return [...new Set(lista)];
}

function nomeComparavel(s) {
  return semAcento(String(s)).toLowerCase().replace(/\s+/g, ' ').trim();
}

function validarBanco(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Arquivo inválido: não é um banco de relatórios.');
  if (!Array.isArray(obj.modulos) || obj.modulos.some((m) => typeof m !== 'string')) throw new Error('Arquivo inválido: lista de módulos ausente.');
  if (!Array.isArray(obj.relatorios)) throw new Error('Arquivo inválido: lista de relatórios ausente.');
  const ids = new Set();
  for (const r of obj.relatorios) {
    if (!r || typeof r.id !== 'string' || typeof r.nome !== 'string' || typeof r.modulo !== 'string' || !Array.isArray(r.colunas)) {
      throw new Error('Arquivo inválido: há relatório com campos faltando.');
    }
    if (ids.has(r.id)) throw new Error('Arquivo inválido: há relatórios com o mesmo id.');
    ids.add(r.id);
    if (!obj.modulos.includes(r.modulo)) obj.modulos.push(r.modulo);
    r.colunas = unicos(r.colunas.map(limparNomeColuna).filter(Boolean));
    r.imagem = typeof r.imagem === 'string' ? r.imagem : null;
    r.imagemOriginal = typeof r.imagemOriginal === 'string' ? r.imagemOriginal : null;
    r.funcionalidade = typeof r.funcionalidade === 'string' && r.funcionalidade.trim() ? r.funcionalidade.replace(/\s+/g, ' ').trim() : null;
  }
  obj.versao = obj.versao || 1;
  obj.ignorados = Array.isArray(obj.ignorados) ? obj.ignorados.filter((x) => typeof x === 'string') : [];
  obj.atualizadoEm = obj.atualizadoEm || null;
  return obj;
}

class Store {
  constructor({ pastaDados, pastaBackup, seedPath }) {
    this.pastaDados = pastaDados;
    this.pastaBackup = pastaBackup;
    this.seedPath = seedPath;
    this.arquivoDados = path.join(pastaDados, 'relatorios.json');
    this.pastaImagens = path.join(pastaDados, 'imagens');
    this.db = null;
    this.avisoInicial = null;
    this._hashUltimoBackup = null;
  }

  // ---------- inicialização ----------

  iniciar() {
    fs.mkdirSync(this.pastaImagens, { recursive: true });
    this._garantirPastaBackup();
    this._hashUltimoBackup = this._hashDoBackupMaisRecente();

    if (!fs.existsSync(this.arquivoDados)) {
      this.db = this._lerSeed();
      this._gravar();
      this.backupSeMudou('auto');
      return this;
    }
    try {
      this.db = validarBanco(JSON.parse(fs.readFileSync(this.arquivoDados, 'utf8')));
    } catch (erro) {
      this._recuperarDeArquivoCorrompido(erro);
    }
    return this;
  }

  _lerSeed() {
    const seed = validarBanco(JSON.parse(fs.readFileSync(this.seedPath, 'utf8')));
    seed.atualizadoEm = new Date().toISOString();
    return seed;
  }

  _recuperarDeArquivoCorrompido(erro) {
    const corrompido = path.join(this.pastaDados, `relatorios.corrompido_${etiquetaData()}.json`);
    try {
      fs.renameSync(this.arquivoDados, corrompido);
    } catch (_) {
      /* segue mesmo assim */
    }
    for (const b of this.listarBackups()) {
      try {
        this.db = validarBanco(JSON.parse(fs.readFileSync(path.join(this.pastaBackup, b.nome), 'utf8')));
        this._gravar();
        this.avisoInicial = `O arquivo de dados estava danificado (${erro.message}). Restauramos o backup ${b.nome}. O arquivo com problema foi guardado como ${path.basename(corrompido)}.`;
        return;
      } catch (_) {
        /* tenta o próximo backup */
      }
    }
    this.db = this._lerSeed();
    this._gravar();
    this.avisoInicial = `O arquivo de dados estava danificado e não havia backup válido. Voltamos à lista original. O arquivo com problema foi guardado como ${path.basename(corrompido)}.`;
  }

  _garantirPastaBackup() {
    fs.mkdirSync(this.pastaBackup, { recursive: true });
    fs.mkdirSync(path.join(this.pastaBackup, 'imagens'), { recursive: true });
  }

  _gravar() {
    this.db.atualizadoEm = new Date().toISOString();
    gravarAtomico(this.arquivoDados, JSON.stringify(this.db, null, 1));
  }

  resumo() {
    const colunas = new Set();
    for (const r of this.db.relatorios) r.colunas.forEach((c) => colunas.add(c));
    return {
      pastaDados: this.pastaDados,
      pastaBackup: this.pastaBackup,
      totalRelatorios: this.db.relatorios.length,
      totalColunas: colunas.size,
      atualizadoEm: this.db.atualizadoEm,
    };
  }

  // ---------- relatórios ----------

  salvarRelatorio(dados) {
    const nome = String(dados.nome || '').replace(/\s+/g, ' ').trim();
    if (!nome) throw new Error('Informe o nome do relatório.');
    if (!this.db.modulos.includes(dados.modulo)) throw new Error('Escolha um módulo válido.');
    const colunas = unicos((dados.colunas || []).map(limparNomeColuna).filter(Boolean));
    const funcionalidadeTxt = String(dados.funcionalidade || '').replace(/\s+/g, ' ').trim();
    const funcionalidade = funcionalidadeTxt || null;

    const repetido = this.db.relatorios.find(
      (r) => r.id !== dados.id && r.modulo === dados.modulo && nomeComparavel(r.nome) === nomeComparavel(nome)
    );
    if (repetido) throw new Error(`Já existe um relatório chamado "${repetido.nome}" no módulo ${dados.modulo}.`);

    if (dados.id) {
      const atual = this.db.relatorios.find((r) => r.id === dados.id);
      if (!atual) throw new Error('Relatório não encontrado. Ele pode ter sido excluído.');
      Object.assign(atual, { nome, modulo: dados.modulo, colunas, funcionalidade });
    } else {
      this.db.relatorios.push({
        id: 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
        modulo: dados.modulo,
        nome,
        colunas,
        imagem: null,
        imagemOriginal: null,
        funcionalidade,
      });
    }
    this._gravar();
    return this.db;
  }

  excluirRelatorio(id) {
    const i = this.db.relatorios.findIndex((r) => r.id === id);
    if (i < 0) throw new Error('Relatório não encontrado.');
    const [removido] = this.db.relatorios.splice(i, 1);
    this._apagarArquivoImagem(removido.imagem);
    this._gravar();
    return this.db;
  }

  // ---------- módulos ----------

  adicionarModulo(nome) {
    const limpo = String(nome || '').trim().replace(/\s+/g, '_');
    if (!limpo) throw new Error('Informe o nome do módulo.');
    if (this.db.modulos.some((m) => m.toLowerCase() === limpo.toLowerCase())) throw new Error(`O módulo ${limpo} já existe.`);
    this.db.modulos.push(limpo);
    this._gravar();
    return this.db;
  }

  excluirModulo(nome) {
    if (!this.db.modulos.includes(nome)) throw new Error('Módulo não encontrado.');
    if (this.db.relatorios.some((r) => r.modulo === nome)) throw new Error('Só é possível excluir módulos sem relatórios.');
    this.db.modulos = this.db.modulos.filter((m) => m !== nome);
    this._gravar();
    return this.db;
  }

  // ---------- colunas ----------

  // Renomeia a coluna em todos os relatórios. Se o novo nome já existe, as duas viram uma só.
  renomearColuna(de, para) {
    const novo = limparNomeColuna(para);
    if (!novo) throw new Error('Informe o novo nome da coluna.');
    let alterados = 0;
    for (const r of this.db.relatorios) {
      const i = r.colunas.indexOf(de);
      if (i < 0) continue;
      r.colunas[i] = novo;
      r.colunas = unicos(r.colunas);
      alterados++;
    }
    if (!alterados) throw new Error('Coluna não encontrada.');
    this.db.ignorados = this.db.ignorados.filter((k) => !k.split('|').includes(de));
    this._gravar();
    return { db: this.db, alterados };
  }

  ignorarSimilar(chave) {
    if (!this.db.ignorados.includes(chave)) {
      this.db.ignorados.push(chave);
      this._gravar();
    }
    return this.db;
  }

  // ---------- imagens ----------

  _apagarArquivoImagem(nome) {
    if (!nome) return;
    try {
      fs.unlinkSync(path.join(this.pastaImagens, path.basename(nome)));
    } catch (_) {
      /* já não existe */
    }
  }

  anexarImagem(id, origem) {
    const rel = this.db.relatorios.find((r) => r.id === id);
    if (!rel) throw new Error('Relatório não encontrado.');
    const ext = path.extname(origem).toLowerCase();
    if (!EXTENSOES_IMAGEM[ext]) throw new Error('Formato de imagem não suportado. Use GIF, PNG, JPG, WEBP ou BMP.');
    const { size } = fs.statSync(origem);
    if (size > LIMITE_IMAGEM) throw new Error('A imagem passa de 10 MB.');
    const nomeNovo = `${rel.id}${ext}`;
    fs.copyFileSync(origem, path.join(this.pastaImagens, nomeNovo));
    if (rel.imagem && rel.imagem !== nomeNovo) this._apagarArquivoImagem(rel.imagem);
    rel.imagem = nomeNovo;
    this._gravar();
    return this.db;
  }

  removerImagem(id) {
    const rel = this.db.relatorios.find((r) => r.id === id);
    if (!rel) throw new Error('Relatório não encontrado.');
    this._apagarArquivoImagem(rel.imagem);
    rel.imagem = null;
    this._gravar();
    return this.db;
  }

  obterImagem(id) {
    const rel = this.db.relatorios.find((r) => r.id === id);
    if (!rel || !rel.imagem) return null;
    const arquivo = path.join(this.pastaImagens, path.basename(rel.imagem));
    if (!fs.existsSync(arquivo)) return null;
    const mime = EXTENSOES_IMAGEM[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${fs.readFileSync(arquivo).toString('base64')}`;
  }

  // Liga as imagens de uma pasta aos relatórios pelo nome do arquivo que a planilha original apontava.
  importarImagensDePasta(pasta) {
    const chave = (s) => semAcento(s).toLowerCase().replace(/\s+/g, '');
    const arquivos = new Map();
    for (const nome of fs.readdirSync(pasta)) {
      if (EXTENSOES_IMAGEM[path.extname(nome).toLowerCase()]) arquivos.set(chave(nome), path.join(pasta, nome));
    }
    let associadas = 0;
    let semArquivo = 0;
    for (const rel of this.db.relatorios) {
      if (!rel.imagemOriginal || rel.imagem) continue;
      const origem = arquivos.get(chave(rel.imagemOriginal));
      if (!origem) {
        semArquivo++;
        continue;
      }
      try {
        this.anexarImagem(rel.id, origem);
        associadas++;
      } catch (_) {
        semArquivo++;
      }
    }
    return { db: this.db, associadas, semArquivo };
  }

  // ---------- backup ----------

  _hashDoBackupMaisRecente() {
    const [mais] = this.listarBackups();
    return mais ? hashDe(fs.readFileSync(path.join(this.pastaBackup, mais.nome))) : null;
  }

  listarBackups() {
    if (!fs.existsSync(this.pastaBackup)) return [];
    return fs
      .readdirSync(this.pastaBackup)
      .filter((n) => PADRAO_BACKUP.test(n))
      .map((nome) => {
        const st = fs.statSync(path.join(this.pastaBackup, nome));
        const tipo = nome.replace(/\.json$/, '').split('_').pop();
        return { nome, tipo, tamanho: st.size, data: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.nome < b.nome ? 1 : -1));
  }

  _espelharImagens() {
    const destino = path.join(this.pastaBackup, 'imagens');
    fs.mkdirSync(destino, { recursive: true });
    for (const nome of fs.existsSync(this.pastaImagens) ? fs.readdirSync(this.pastaImagens) : []) {
      const de = path.join(this.pastaImagens, nome);
      const para = path.join(destino, nome);
      if (!fs.existsSync(para) || fs.statSync(para).size !== fs.statSync(de).size) fs.copyFileSync(de, para);
    }
  }

  criarBackup(tipo = 'manual') {
    this._garantirPastaBackup();
    this._espelharImagens();
    const nome = `dados_${etiquetaData()}_${tipo}.json`;
    fs.copyFileSync(this.arquivoDados, path.join(this.pastaBackup, nome));
    this._hashUltimoBackup = hashDe(fs.readFileSync(this.arquivoDados));
    this._limparBackupsAntigos();
    return nome;
  }

  // Só cria backup se o arquivo mudou desde o último.
  backupSeMudou(tipo = 'auto') {
    if (!this.db) return null;
    const atual = hashDe(fs.readFileSync(this.arquivoDados));
    if (atual === this._hashUltimoBackup) return null;
    return this.criarBackup(tipo);
  }

  _limparBackupsAntigos() {
    const automaticos = this.listarBackups().filter((b) => b.tipo === 'auto');
    for (const b of automaticos.slice(MAX_BACKUPS_AUTOMATICOS)) {
      try {
        fs.unlinkSync(path.join(this.pastaBackup, b.nome));
      } catch (_) {
        /* ignora */
      }
    }
  }

  _restaurarImagensFaltantes() {
    const origem = path.join(this.pastaBackup, 'imagens');
    if (!fs.existsSync(origem)) return;
    for (const rel of this.db.relatorios) {
      if (!rel.imagem) continue;
      const local = path.join(this.pastaImagens, rel.imagem);
      const backup = path.join(origem, rel.imagem);
      if (!fs.existsSync(local) && fs.existsSync(backup)) fs.copyFileSync(backup, local);
    }
  }

  _trocarBanco(novo, tipoBackup) {
    if (this.db) this.criarBackup(tipoBackup);
    this.db = novo;
    this._gravar();
    this._restaurarImagensFaltantes();
    return this.db;
  }

  restaurarBackup(nome) {
    if (path.basename(nome) !== nome || !PADRAO_BACKUP.test(nome)) throw new Error('Backup inválido.');
    const arquivo = path.join(this.pastaBackup, nome);
    if (!fs.existsSync(arquivo)) throw new Error('Esse backup não existe mais na pasta.');
    const novo = validarBanco(JSON.parse(fs.readFileSync(arquivo, 'utf8')));
    return this._trocarBanco(novo, 'antes-de-restaurar');
  }

  exportarPara(destino) {
    fs.copyFileSync(this.arquivoDados, destino);
  }

  importarDe(origem) {
    let novo;
    try {
      novo = validarBanco(JSON.parse(fs.readFileSync(origem, 'utf8')));
    } catch (erro) {
      throw new Error(erro instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : erro.message);
    }
    return this._trocarBanco(novo, 'antes-de-importar');
  }

  definirPastaBackup(nova) {
    fs.mkdirSync(path.join(nova, 'imagens'), { recursive: true });
    const teste = path.join(nova, '.teste-escrita');
    fs.writeFileSync(teste, 'ok');
    fs.unlinkSync(teste);
    this.pastaBackup = nova;
    this._hashUltimoBackup = this._hashDoBackupMaisRecente();
    return this.criarBackup('manual');
  }
}

module.exports = { Store, validarBanco, PADRAO_BACKUP, EXTENSOES_IMAGEM };
