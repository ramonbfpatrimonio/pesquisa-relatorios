'use strict';
/*
 * Motor de sincronização com o Supabase. Fica no processo principal (main.js), não na tela.
 *
 * Design pra dar pra testar sem internet: quem cria a instância injeta uma "fábrica de cliente"
 * (criarCliente), então os testes passam um cliente de mentira com a mesma forma do supabase-js.
 * Em produção, main.js injeta o createClient de verdade.
 *
 * Regra de conflito: a última gravação vence — é só isso mesmo, sem mesclar campo a campo.
 * Ao editar localmente, registrarMudancaLocal manda só o que mudou (diff); se der erro de rede,
 * a próxima chamada tenta de novo automaticamente (o "antes" não avança até o envio funcionar).
 */

const path = require('path');
const fs = require('fs');
const { TABELAS, dbParaLinhas, linhasParaDb, diffLinhas } = require('./dados-nuvem');

const MIME_IMAGEM = { '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' };

function mensagemErro(erro, generica) {
  if (!erro) return generica;
  if (typeof erro === 'string') return erro;
  return erro.message || generica;
}

class Nuvem {
  constructor({ criarCliente, aoAtualizarDados, aoAtualizarStatus, atraso = 400 } = {}) {
    this._criarCliente = criarCliente; // (url, anonKey) => clienteSupabase
    this._aoAtualizarDados = aoAtualizarDados || (() => {}); // (db) => void — chamado após pull/realtime
    this._aoAtualizarStatus = aoAtualizarStatus || (() => {}); // (status) => void
    this._atraso = atraso;

    this.cliente = null;
    this.email = null;
    this.papel = null; // 'admin' | 'editor' | null
    this.leituraAtiva = false; // conectado e sincronizando — não precisa de login pra isso
    this.autenticado = false; // tem sessão de escrita (fez login no Ctrl+Shift+B)
    this.sincronizando = false;
    this.ultimoErro = null;

    this._ultimoSnapshot = null; // última "foto" (linhas) que sabemos que bate com o servidor
    this._obterBaseLocal = null; // () => campos que não vão pra nuvem (preferências deste computador)
    this._canal = null;
    this._timerRealtime = null;
  }

  status() {
    return {
      leituraAtiva: this.leituraAtiva,
      autenticado: this.autenticado,
      email: this.email,
      papel: this.papel,
      sincronizando: this.sincronizando,
      ultimoErro: this.ultimoErro,
    };
  }

  _emitirStatus() {
    this._aoAtualizarStatus(this.status());
  }

  configurar(url, anonKey) {
    if (!url || !anonKey || /COLE_AQUI/.test(url) || /COLE_AQUI/.test(anonKey)) {
      throw new Error('A nuvem ainda não foi configurada neste programa (falta a URL/chave do Supabase).');
    }
    this.cliente = this._criarCliente(url, anonKey);
    return this.cliente;
  }

  // Chama uma vez, ao abrir o programa (se a nuvem estiver configurada). Não exige login — a leitura
  // é livre. Fica ouvindo mudanças em tempo real dali em diante, até o programa fechar.
  async iniciarSincronizacao(obterBaseLocal) {
    if (!this.cliente) throw new Error('A nuvem ainda não foi configurada neste programa.');
    this._obterBaseLocal = obterBaseLocal || (() => ({}));
    const db = await this._puxarTudoEAplicar();
    this._assinarTempoReal();
    this.leituraAtiva = true;
    this._emitirStatus();
    return db;
  }

  // ---------- login/logout (só eleva/derruba a permissão de escrita no MESMO cliente) ----------

  async entrar(email, senha) {
    if (!this.cliente) throw new Error('A nuvem ainda não foi configurada neste programa.');
    const limpo = String(email || '').trim().toLowerCase();
    if (!limpo || !senha) throw new Error('Preencha o e-mail e a senha.');

    const { data, error } = await this.cliente.auth.signInWithPassword({ email: limpo, password: senha });
    if (error || !data?.session) throw new Error('E-mail ou senha incorretos.');

    const { data: perfil } = await this.cliente.from('usuarios').select('papel').eq('email', limpo).maybeSingle();
    this.email = limpo;
    this.papel = perfil?.papel || null;
    this.autenticado = true;
    this.ultimoErro = null;
    this._emitirStatus();
    return { email: this.email, papel: this.papel };
  }

  async sair() {
    try {
      if (this.cliente) await this.cliente.auth.signOut();
    } catch (_) {
      /* mesmo se falhar, esquece a sessão localmente */
    }
    this.email = null;
    this.papel = null;
    this.autenticado = false;
    this.ultimoErro = null;
    this._emitirStatus();
    // a leitura em tempo real continua ligada — só a permissão de escrever que cai
  }

  podeEscrever() {
    return this.autenticado && (this.papel === 'admin' || this.papel === 'editor');
  }

  // ---------- puxar (pull) ----------

  async _buscarLinhas() {
    const linhas = {};
    for (const tabela of Object.keys(TABELAS)) {
      const { data, error } = await this.cliente.from(tabela).select('*');
      if (error) throw new Error(mensagemErro(error, `Não consegui ler a tabela ${tabela}.`));
      linhas[tabela] = data || [];
    }
    return linhas;
  }

  // Depois de aplicar os dados da nuvem, quem chamou normaliza o banco (ex.: store.js arruma
  // maiúsculas/duplicatas). Chame isto passando o banco JÁ normalizado, senão a próxima comparação
  // acha diferença onde não tem — e fica reenviando pra nuvem à toa, pra sempre.
  sincronizarRetratoCom(db) {
    this._ultimoSnapshot = dbParaLinhas(db);
  }

  async _puxarTudoEAplicar() {
    this.sincronizando = true;
    this._emitirStatus();
    try {
      const linhas = await this._buscarLinhas();
      this._ultimoSnapshot = linhas;
      const baseAntes = this._obterBaseLocal ? this._obterBaseLocal() : {};
      const vazia = !linhas.relatorios.length && !linhas.modulos.length;
      // Nuvem ainda vazia (ninguém migrou os dados pra lá) e este computador nunca sincronizou:
      // não apaga os dados locais. Continua ouvindo — assim que alguém migrar, isto se resolve sozinho.
      if (vazia && !baseAntes.nuvemVinculada) {
        this.ultimoErro = null;
        return null;
      }
      const db = linhasParaDb(linhas, { ...baseAntes, nuvemVinculada: true });
      this._aoAtualizarDados(db);
      this.ultimoErro = null;
      return db;
    } catch (erro) {
      this.ultimoErro = mensagemErro(erro, 'Falha ao buscar os dados da nuvem.');
      throw erro;
    } finally {
      this.sincronizando = false;
      this._emitirStatus();
    }
  }


  // ---------- enviar (push) ----------

  // Chamar depois de qualquer alteração local (o próprio store.js já mudou o arquivo local; isso só
  // reflete a mudança na nuvem). Sem sessão, não faz nada — o programa continua funcionando só local.
  async registrarMudancaLocal(db) {
    if (!this.podeEscrever()) return { enviado: false };
    const novasLinhas = dbParaLinhas(db);
    const diff = diffLinhas(this._ultimoSnapshot || {}, novasLinhas);
    if (diff.vazio) return { enviado: false };
    await this._enviarDiff(diff);
    this._ultimoSnapshot = novasLinhas; // só avança depois de confirmado — erro faz a próxima tentativa incluir isto de novo
    return { enviado: true };
  }

  async _enviarDiff(diff) {
    this.sincronizando = true;
    this._emitirStatus();
    try {
      for (const [tabela, linhas] of Object.entries(diff.upserts)) {
        const { error } = await this.cliente.from(tabela).upsert(linhas);
        if (error) throw new Error(mensagemErro(error, `Não consegui salvar em ${tabela}.`));
      }
      for (const [tabela, chaves] of Object.entries(diff.deletes)) {
        const { chave } = TABELAS[tabela];
        const { error } = await this.cliente.from(tabela).delete().in(chave, chaves);
        if (error) throw new Error(mensagemErro(error, `Não consegui apagar em ${tabela}.`));
      }
      this.ultimoErro = null;
    } catch (erro) {
      this.ultimoErro = mensagemErro(erro, 'Falha ao enviar para a nuvem.');
      throw erro;
    } finally {
      this.sincronizando = false;
      this._emitirStatus();
    }
  }

  // Botão "Enviar dados desta máquina para a nuvem" — primeira carga ou "essa máquina manda".
  // Manda tudo como upsert e apaga da nuvem o que não existe mais aqui.
  async enviarTudo(db) {
    if (!this.podeEscrever()) throw new Error('Entre com seu login antes de enviar.');
    const linhasAtuais = await this._buscarLinhas();
    const novasLinhas = dbParaLinhas(db);
    const diff = diffLinhas(linhasAtuais, novasLinhas);
    if (!diff.vazio) await this._enviarDiff(diff);
    this._ultimoSnapshot = novasLinhas;
    return { alterados: !diff.vazio };
  }

  // ---------- tempo real ----------

  _assinarTempoReal() {
    this._desligarTempoReal();
    const canal = this.cliente.channel('mudancas-dados');
    for (const tabela of Object.keys(TABELAS)) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabela }, () => this._avisadoDeMudanca());
    }
    canal.subscribe();
    this._canal = canal;
  }

  _desligarTempoReal() {
    if (this._timerRealtime) {
      clearTimeout(this._timerRealtime);
      this._timerRealtime = null;
    }
    if (this._canal && this.cliente) {
      try {
        this.cliente.removeChannel(this._canal);
      } catch (_) {
        /* já desconectado */
      }
    }
    this._canal = null;
  }

  // Várias mudanças chegam quase juntas (ex.: importação em massa) — espera um instante e busca uma
  // vez só, em vez de uma vez por linha alterada.
  _avisadoDeMudanca() {
    if (this._timerRealtime) clearTimeout(this._timerRealtime);
    this._timerRealtime = setTimeout(() => {
      this._puxarTudoEAplicar().catch(() => {}); // erro já registrado em status(); tenta de novo na próxima mudança
    }, this._atraso);
  }

  // ---------- imagens (Storage) ----------

  async subirImagem(caminhoLocal, nomeArquivo) {
    if (!this.cliente) throw new Error('A nuvem ainda não foi configurada neste programa.');
    const buffer = fs.readFileSync(caminhoLocal);
    const contentType = MIME_IMAGEM[path.extname(nomeArquivo).toLowerCase()] || 'application/octet-stream';
    const { error } = await this.cliente.storage.from('imagens').upload(nomeArquivo, buffer, { contentType, upsert: true });
    if (error) throw new Error(mensagemErro(error, 'Não consegui enviar a imagem.'));
  }

  async baixarImagem(nomeArquivo, destinoLocal) {
    if (!this.cliente) throw new Error('A nuvem ainda não foi configurada neste programa.');
    const { data, error } = await this.cliente.storage.from('imagens').download(nomeArquivo);
    if (error) throw new Error(mensagemErro(error, 'Não consegui buscar a imagem.'));
    const buffer = Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(destinoLocal, buffer);
  }

  async apagarImagem(nomeArquivo) {
    if (!this.cliente || !nomeArquivo) return;
    try {
      await this.cliente.storage.from('imagens').remove([nomeArquivo]);
    } catch (_) {
      /* sem problema se já não existir */
    }
  }

  // ---------- usuários (via Edge Function; a chave de administração nunca entra no programa) ----------

  async chamarFuncaoUsuarios(acao, payload) {
    if (!this.cliente) throw new Error('A nuvem ainda não foi configurada neste programa.');
    const { data, error } = await this.cliente.functions.invoke('gerenciar-usuarios', { body: { acao, ...payload } });
    if (error) throw new Error(mensagemErro(error, 'Falha ao falar com o servidor.'));
    if (data && data.erro) throw new Error(data.erro);
    return data;
  }

  criarUsuario(email, senha, papel) {
    return this.chamarFuncaoUsuarios('criar', { email, senha, papel });
  }
  redefinirSenhaDeUsuario(email, senha) {
    return this.chamarFuncaoUsuarios('redefinirSenha', { email, senha });
  }
  definirPapelDeUsuario(email, papel) {
    return this.chamarFuncaoUsuarios('papel', { email, papel });
  }
  excluirUsuario(email) {
    return this.chamarFuncaoUsuarios('excluir', { email });
  }
  listarUsuarios() {
    if (!this.cliente) throw new Error('A nuvem ainda não foi configurada neste programa.');
    return this.cliente
      .from('usuarios')
      .select('email, papel, criado_em')
      .then(({ data, error }) => {
        if (error) throw new Error(mensagemErro(error, 'Não consegui listar os usuários.'));
        return data || [];
      });
  }

  redefinirMinhaSenha(senhaNova) {
    if (!this.cliente) throw new Error('A nuvem ainda não foi configurada neste programa.');
    return this.cliente.auth.updateUser({ password: senhaNova }).then(({ error }) => {
      if (error) throw new Error(mensagemErro(error, 'Não consegui trocar sua senha.'));
    });
  }
}

module.exports = { Nuvem };
