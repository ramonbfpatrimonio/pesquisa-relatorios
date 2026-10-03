'use strict';
/*
 * Ações que a tela pode pedir ao sistema. Ficam aqui (e não no main.js) para poderem
 * ser testadas sem abrir o Electron: as janelas de arquivo entram pelo parâmetro "dialogo".
 *
 * Todo handler devolve { ok: true, dados } ou { ok: false, erro }.
 */
const fs = require('fs');
const path = require('path');
const { EXTENSOES_IMAGEM, LIMITE_IMAGEM } = require('./store');

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

function criarHandlers({ store, dialogo, abrirPasta, abrirArquivo, salvarPastaBackup, versao, verificarAtualizacoes, baixarAtualizacao, instalarAtualizacao, nuvem }) {
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

  // Compartilhada entre "anexarImagem" (abre a janela e anexa na hora) e "anexarImagemDeArquivo"
  // (o caminho já foi escolhido antes — usada ao salvar as imagens de um relatório recém-criado).
  function anexarImagemDeCaminho(id, tipo, caminho) {
    const db = store.anexarImagem(id, caminho, tipo);
    const rel = db.relatorios.find((r) => r.id === id);
    const nomeArquivo = tipo === 'filtro' ? rel.imagemFiltro : rel.imagem;
    if (nuvem.podeEscrever()) nuvem.subirImagem(path.join(store.pastaImagens, nomeArquivo), nomeArquivo).catch(() => {});
    return db;
  }

  const acoes = {
    carregar: () => uteis(),

    salvarRelatorio: (rel) => store.salvarRelatorio(rel),
    excluirRelatorio: (id) => store.excluirRelatorio(id),
    adicionarModulo: (nome) => store.adicionarModulo(nome),
    excluirModulo: (nome) => store.excluirModulo(nome),
    definirModulosOcultos: (nomes) => store.definirModulosOcultos(nomes),
    definirTema: (tema) => store.definirTema(tema),
    renomearColuna: (de, para) => store.renomearColuna(de, para),
    renomearFiltro: (de, para) => store.renomearFiltro(de, para),
    criarColuna: (nome) => store.criarColuna(nome),
    criarFiltro: (dados) => store.criarFiltro(dados),
    ignorarSimilar: (chave) => store.ignorarSimilar(chave),

    // Se a imagem ainda não existe neste computador (outra máquina anexou), baixa da nuvem na hora.
    obterImagem: async (id, tipo) => {
      const rel = store.db.relatorios.find((r) => r.id === id);
      const nomeArquivo = rel && (tipo === 'filtro' ? rel.imagemFiltro : rel.imagem);
      if (nomeArquivo && nuvem.leituraAtiva) {
        const caminho = path.join(store.pastaImagens, nomeArquivo);
        if (!fs.existsSync(caminho)) {
          try {
            await nuvem.baixarImagem(nomeArquivo, caminho);
          } catch (_) {
            /* sem internet ou arquivo ainda não subiu: mostra "não encontrada", tenta de novo na próxima */
          }
        }
      }
      return store.obterImagem(id, tipo);
    },
    removerImagem: (id, tipo) => {
      const rel = store.db.relatorios.find((r) => r.id === id);
      const nomeArquivo = rel && (tipo === 'filtro' ? rel.imagemFiltro : rel.imagem);
      const db = store.removerImagem(id, tipo);
      if (nomeArquivo && nuvem.podeEscrever()) nuvem.apagarImagem(nomeArquivo).catch(() => {});
      return db;
    },
    anexarImagem: async (id, tipo) => {
      const arquivo = await dialogo.abrirImagem();
      if (!arquivo) return null;
      return anexarImagemDeCaminho(id, tipo, arquivo);
    },
    // Abre só a janela de escolher arquivo, sem anexar em nada — usado quando o relatório ainda
    // nem foi salvo (não existe ID pra anexar ainda). O caminho fica guardado na tela até salvar.
    escolherArquivoImagem: async () => dialogo.abrirImagem(),
    // Lê um arquivo de imagem qualquer do disco e devolve pronto pra mostrar (data:...), sem
    // precisar que ele já esteja ligado a nenhum relatório — é a prévia de uma imagem ainda não
    // anexada (relatório novo, antes de salvar).
    lerArquivoComoImagem: async (caminho) => {
      if (!caminho || !fs.existsSync(caminho)) throw new Error('Arquivo não encontrado.');
      const ext = path.extname(caminho).toLowerCase();
      if (!EXTENSOES_IMAGEM[ext]) throw new Error('Formato de imagem não suportado. Use GIF, PNG, JPG, WEBP ou BMP.');
      if (fs.statSync(caminho).size > LIMITE_IMAGEM) throw new Error('A imagem passa de 10 MB.');
      return `data:${EXTENSOES_IMAGEM[ext]};base64,${fs.readFileSync(caminho).toString('base64')}`;
    },
    // Anexa um arquivo cujo caminho já foi escolhido antes (via escolherArquivoImagem) — usado
    // para anexar as imagens assim que um relatório novo acaba de ser criado.
    anexarImagemDeArquivo: (id, tipo, caminho) => anexarImagemDeCaminho(id, tipo, caminho),
    // Abre a imagem no visualizador padrão do Windows — tamanho e formato originais, de verdade
    // (o que aparece dentro do programa é só uma prévia, redimensionada pra caber na tela).
    abrirImagemNoSistema: async (id, tipo) => {
      const rel = store.db.relatorios.find((r) => r.id === id);
      const nomeArquivo = rel && (tipo === 'filtro' ? rel.imagemFiltro : rel.imagem);
      if (!nomeArquivo) throw new Error('Esse relatório não tem essa imagem.');
      const caminho = path.join(store.pastaImagens, nomeArquivo);
      if (!fs.existsSync(caminho) && nuvem.leituraAtiva) {
        try {
          await nuvem.baixarImagem(nomeArquivo, caminho);
        } catch (_) {
          /* mostra o erro de "não encontrada" abaixo */
        }
      }
      if (!fs.existsSync(caminho)) throw new Error('O arquivo da imagem não foi encontrado.');
      await abrirArquivo(caminho);
    },
    importarImagensDePasta: async () => {
      const pasta = await dialogo.abrirPastaImagens();
      if (!pasta) return null;
      const antes = new Set(store.db.relatorios.filter((r) => r.imagemFiltro).map((r) => r.id));
      const r = store.importarImagensDePasta(pasta);
      if (nuvem.podeEscrever()) {
        for (const rel of r.db.relatorios) {
          if (rel.imagemFiltro && !antes.has(rel.id)) {
            nuvem.subirImagem(path.join(store.pastaImagens, rel.imagemFiltro), rel.imagemFiltro).catch(() => {});
          }
        }
      }
      return r;
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

    // ---------- nuvem ----------
    nuvemStatus: () => nuvem.status(),
    nuvemEntrar: (email, senha) => nuvem.entrar(email, senha),
    nuvemSair: () => nuvem.sair(),
    nuvemEnviarTudo: () => nuvem.enviarTudo(store.db),
    nuvemListarUsuarios: () => nuvem.listarUsuarios(),
    nuvemCriarUsuario: (email, senha, papel) => nuvem.criarUsuario(email, senha, papel),
    nuvemRedefinirSenhaUsuario: (email, senha) => nuvem.redefinirSenhaDeUsuario(email, senha),
    nuvemDefinirPapel: (email, papel) => nuvem.definirPapelDeUsuario(email, papel),
    nuvemExcluirUsuario: (email) => nuvem.excluirUsuario(email),
    nuvemRedefinirMinhaSenha: (senha) => nuvem.redefinirMinhaSenha(senha),
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
