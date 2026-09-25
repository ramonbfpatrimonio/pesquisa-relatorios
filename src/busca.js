/*
 * Lógica de pesquisa por colunas.
 * Funciona no navegador (window.Busca) e no Node (require), sem dependências.
 */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Busca = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function semAcento(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Nome padrão de coluna: sem espaços sobrando e em maiúsculas (igual à planilha).
  function limparNomeColuna(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function normalizarBusca(s) {
    return semAcento(s).toUpperCase().trim();
  }

  // Chave "frouxa" para achar nomes parecidos: ignora _, /, ., -, espaço e acento.
  // O % fica: %_VENDA (percentual) não é a mesma coisa que VENDA.
  function chaveFrouxa(s) {
    return semAcento(s).toUpperCase().replace(/[\s_/.\-]/g, '');
  }

  // QUANTIDADE, QUANTIDADE_1 e QUANTIDADE_2 são colunas diferentes, não erros de digitação.
  function diferemSoPorNumeroFinal(x, y) {
    const raizX = x.replace(/\d+$/, '');
    const raizY = y.replace(/\d+$/, '');
    return raizX === raizY && (raizX !== x || raizY !== y);
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 9;
    let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const atual = [i];
      for (let j = 1; j <= b.length; j++) {
        atual.push(Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
      }
      anterior = atual;
    }
    return anterior[b.length];
  }

  function relatoriosDoEscopo(relatorios, modulo) {
    return !modulo || modulo === '*' ? relatorios : relatorios.filter((r) => r.modulo === modulo);
  }

  // Colunas existentes no escopo, com a quantidade de relatórios que usam cada uma.
  function colunasDoEscopo(relatorios, modulo) {
    const contagem = new Map();
    for (const r of relatoriosDoEscopo(relatorios, modulo)) {
      for (const c of r.colunas) contagem.set(c, (contagem.get(c) || 0) + 1);
    }
    return [...contagem.entries()]
      .map(([nome, qtd]) => ({ nome, qtd }))
      .sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt'));
  }

  // Todas as colunas com os módulos onde aparecem (tela "Colunas").
  function estatisticasColunas(relatorios) {
    const mapa = new Map();
    for (const r of relatorios) {
      for (const c of r.colunas) {
        if (!mapa.has(c)) mapa.set(c, { nome: c, qtd: 0, modulos: new Set() });
        const e = mapa.get(c);
        e.qtd++;
        e.modulos.add(r.modulo);
      }
    }
    return [...mapa.values()]
      .map((e) => ({ nome: e.nome, qtd: e.qtd, modulos: [...e.modulos].sort() }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  }

  // Sugestões para o campo de digitação: começa com > começa uma palavra > contém.
  function sugerirColunas(opcoes, texto, excluir, limite) {
    const fora = excluir || new Set();
    const max = limite || 40;
    const busca = normalizarBusca(texto || '');
    const saida = [];
    for (const op of opcoes) {
      if (fora.has(op.nome)) continue;
      if (!busca) {
        saida.push({ ...op, ordem: 0 });
        continue;
      }
      const nome = normalizarBusca(op.nome);
      let ordem = -1;
      if (nome === busca) ordem = 0;
      else if (nome.startsWith(busca)) ordem = 1;
      else if (new RegExp('[_ /%-]' + busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(nome)) ordem = 2;
      else if (nome.includes(busca)) ordem = 3;
      if (ordem >= 0) saida.push({ ...op, ordem });
    }
    // Caixa vazia (acabou de clicar, sem digitar nada): lista em ordem alfabética, não por frequência,
    // e sem cortar em 40 — senão módulos com muitas colunas escondem tudo depois de "C" ou "D" (o menu já rola).
    if (!busca) {
      saida.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
      return saida.map(({ nome, qtd }) => ({ nome, qtd }));
    }
    saida.sort((a, b) => a.ordem - b.ordem || b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt'));
    return saida.slice(0, max).map(({ nome, qtd }) => ({ nome, qtd }));
  }

  /*
   * Pesquisa: agrupa os relatórios pela quantidade de colunas escolhidas que eles têm
   * (é o que a macro da planilha fazia com os checkboxes 1 a 5).
   */
  function pesquisar(relatorios, { modulo, colunas }) {
    const escolhidas = colunas || [];
    const n = escolhidas.length;
    const vazio = { n, total: 0, grupos: [], sugestoes: [] };
    if (!n) return vazio;

    const porAcertos = new Map();
    for (const rel of relatoriosDoEscopo(relatorios, modulo)) {
      const tem = new Set(rel.colunas);
      const acertos = escolhidas.filter((c) => tem.has(c));
      if (!acertos.length) continue;
      const faltam = escolhidas.filter((c) => !tem.has(c));
      if (!porAcertos.has(acertos.length)) porAcertos.set(acertos.length, []);
      porAcertos.get(acertos.length).push({ rel, acertos: acertos.length, faltam });
    }

    const grupos = [...porAcertos.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([acertos, itens]) => ({
        acertos,
        itens: itens.sort((a, b) => a.rel.nome.localeCompare(b.rel.nome, 'pt')),
      }));

    const total = grupos.reduce((s, g) => s + g.itens.length, 0);
    const sugestoes = [];
    if (grupos.length) {
      const melhores = grupos[0].itens;
      const cont = new Map();
      for (const { rel } of melhores) {
        for (const c of rel.colunas) if (!escolhidas.includes(c)) cont.set(c, (cont.get(c) || 0) + 1);
      }
      sugestoes.push(
        ...[...cont.entries()]
          .map(([nome, qtd]) => ({ nome, qtd }))
          .sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt'))
          .slice(0, 12)
      );
    }
    return { n, total, grupos, sugestoes };
  }

  /*
   * Nomes de colunas que parecem a mesma coisa escrita de jeitos diferentes
   * (FAMILA / FAMILIA, ICMSST / ICMS_ST, CNPJ/CPF / CNPJ_CPF).
   */
  function colunasSimilares(relatorios, ignorados) {
    const ignoradas = new Set(ignorados || []);
    const contagem = new Map();
    for (const r of relatorios) for (const c of r.colunas) contagem.set(c, (contagem.get(c) || 0) + 1);
    const nomes = [...contagem.keys()].map((nome) => ({ nome, chave: chaveFrouxa(nome) }));
    const pares = [];
    for (let i = 0; i < nomes.length; i++) {
      for (let j = i + 1; j < nomes.length; j++) {
        const a = nomes[i];
        const b = nomes[j];
        const iguais = a.chave === b.chave;
        if (diferemSoPorNumeroFinal(a.chave, b.chave)) continue;
        let parecidos = false;
        const tamanhoOk = Math.abs(a.chave.length - b.chave.length) <= 1;
        if (!iguais && tamanhoOk && a.chave.length >= 4 && b.chave.length >= 4 && levenshtein(a.chave, b.chave) === 1) {
          const qa = contagem.get(a.nome);
          const qb = contagem.get(b.nome);
          if (a.chave.length >= 6 && b.chave.length >= 6) {
            parecidos = true;
          } else {
            // Nomes curtos só entram quando um é raro e o outro comum (VAOR x VALOR), para não gerar ruído.
            parecidos = Math.min(qa, qb) <= 2 && Math.max(qa, qb) >= 5;
          }
          // Só o % de diferença (VENDA x %VENDA) é diferença de significado, não de digitação.
          if (a.chave.replace(/%/g, '') === b.chave.replace(/%/g, '')) parecidos = false;
        }
        if (!iguais && !parecidos) continue;
        const chave = [a.nome, b.nome].sort().join('|');
        if (ignoradas.has(chave)) continue;
        pares.push({ a: a.nome, qa: contagem.get(a.nome), b: b.nome, qb: contagem.get(b.nome), chave });
      }
    }
    return pares.sort((x, y) => Math.max(y.qa, y.qb) - Math.max(x.qa, x.qb) || x.a.localeCompare(y.a, 'pt'));
  }

  function celulaCSV(v) {
    const t = String(v ?? '');
    return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  // CSV com ";" (padrão do Excel em português).
  function gerarCSV(resultado, escolhidas) {
    const linhas = [['Módulo', 'Relatório', 'Colunas em comum', 'Total escolhidas', 'Colunas que faltam', 'Todas as colunas do relatório']];
    for (const g of resultado.grupos) {
      for (const it of g.itens) {
        linhas.push([it.rel.modulo, it.rel.nome, g.acertos, escolhidas.length, it.faltam.join(', '), it.rel.colunas.join(', ')]);
      }
    }
    return linhas.map((l) => l.map(celulaCSV).join(';')).join('\r\n') + '\r\n';
  }

  return {
    semAcento,
    limparNomeColuna,
    normalizarBusca,
    chaveFrouxa,
    levenshtein,
    relatoriosDoEscopo,
    colunasDoEscopo,
    estatisticasColunas,
    sugerirColunas,
    pesquisar,
    colunasSimilares,
    gerarCSV,
  };
});
