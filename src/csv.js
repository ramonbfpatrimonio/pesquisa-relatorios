'use strict';
/*
 * Leitura do CSV de importação em lote de relatórios.
 * Formato esperado (cabeçalho na primeira linha): MODULO, NOME, FUNCIONALIDADE, COLUNAS
 * A coluna COLUNAS leva todos os nomes de coluna do relatório numa célula só, separados por ";".
 * Aceita separador "," ou ";" (detecta sozinho) e cabeçalho em qualquer ordem.
 * Funciona no navegador (window.Csv) e no Node (require), sem dependências.
 */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Csv = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CABECALHO_OBRIGATORIO = ['MODULO', 'NOME', 'COLUNAS'];
  const CABECALHO_TODO = ['MODULO', 'NOME', 'FUNCIONALIDADE', 'COLUNAS'];

  // Quebra o texto em linhas x campos respeitando aspas (padrão CSV/RFC 4180):
  // campo com separador, aspas ou quebra de linha dentro vem entre aspas, com "" para escapar aspas.
  function partirLinhasCSV(texto, separador) {
    const linhas = [];
    let campo = '';
    let linhaAtual = [];
    let dentroAspas = false;
    let i = 0;
    while (i < texto.length) {
      const c = texto[i];
      if (dentroAspas) {
        if (c === '"') {
          if (texto[i + 1] === '"') {
            campo += '"';
            i += 2;
            continue;
          }
          dentroAspas = false;
          i++;
          continue;
        }
        campo += c;
        i++;
        continue;
      }
      if (c === '"') {
        dentroAspas = true;
        i++;
        continue;
      }
      if (c === separador) {
        linhaAtual.push(campo);
        campo = '';
        i++;
        continue;
      }
      if (c === '\n') {
        linhaAtual.push(campo);
        campo = '';
        linhas.push(linhaAtual);
        linhaAtual = [];
        i++;
        continue;
      }
      campo += c;
      i++;
    }
    if (campo !== '' || linhaAtual.length) {
      linhaAtual.push(campo);
      linhas.push(linhaAtual);
    }
    // remove linhas totalmente vazias (ex.: linha em branco sobrando no fim do arquivo)
    return linhas.filter((l) => !(l.length <= 1 && String(l[0] || '').trim() === ''));
  }

  // Conta ; e , fora de aspas na primeira linha para decidir o separador do arquivo inteiro.
  function detectarSeparador(primeiraLinha) {
    const semAspas = primeiraLinha.replace(/"[^"]*"/g, '');
    const pontoEVirgula = (semAspas.match(/;/g) || []).length;
    const virgula = (semAspas.match(/,/g) || []).length;
    return pontoEVirgula > virgula ? ';' : ',';
  }

  function normalizarCabecalho(campo) {
    return String(campo || '')
      .trim()
      .toUpperCase();
  }

  function analisarCSV(textoOriginal) {
    let texto = String(textoOriginal || '');
    if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1); // BOM do Excel
    texto = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!texto.trim()) return { ok: false, erroGeral: 'O arquivo está vazio.' };

    const primeiraLinha = texto.split('\n')[0] || '';
    const separador = detectarSeparador(primeiraLinha);
    const linhasBrutas = partirLinhasCSV(texto, separador);
    if (!linhasBrutas.length) return { ok: false, erroGeral: 'O arquivo está vazio.' };

    const cabecalho = linhasBrutas[0].map(normalizarCabecalho);
    const indice = {};
    for (const nome of CABECALHO_TODO) indice[nome] = cabecalho.indexOf(nome);
    const faltando = CABECALHO_OBRIGATORIO.filter((n) => indice[n] === -1);
    if (faltando.length) {
      return {
        ok: false,
        erroGeral: `Faltam as colunas ${faltando.join(', ')} no cabeçalho da planilha. A primeira linha precisa ter: MODULO, NOME, FUNCIONALIDADE, COLUNAS (FUNCIONALIDADE pode faltar, as outras não).`,
      };
    }
    if (linhasBrutas.length < 2) {
      return { ok: false, erroGeral: 'O arquivo só tem o cabeçalho, nenhuma linha de relatório.' };
    }

    const linhas = [];
    for (let l = 1; l < linhasBrutas.length; l++) {
      const cols = linhasBrutas[l];
      const numeroLinha = l + 1; // linha 1 é o cabeçalho, igual no Excel
      const pega = (chave) => (indice[chave] >= 0 ? String(cols[indice[chave]] ?? '').trim() : '');
      const modulo = pega('MODULO').replace(/\s+/g, '_');
      const nome = pega('NOME').replace(/\s+/g, ' ').trim();
      const funcionalidade = pega('FUNCIONALIDADE').replace(/\s+/g, ' ').trim();
      const colunas = pega('COLUNAS')
        .split(';')
        .map((c) => c.trim())
        .filter(Boolean);

      const erros = [];
      if (!modulo) erros.push('faltou o módulo');
      if (!nome) erros.push('faltou o nome do relatório');
      if (!colunas.length) erros.push('faltou pelo menos uma coluna');

      linhas.push({ numeroLinha, modulo, nome, funcionalidade: funcionalidade || null, colunas, erros });
    }
    return { ok: true, separador, linhas };
  }

  return { analisarCSV, CABECALHO_OBRIGATORIO, CABECALHO_TODO };
});
