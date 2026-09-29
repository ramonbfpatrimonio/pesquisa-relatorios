'use strict';
/*
 * Tradução entre o banco em memória (o mesmo formato do relatorios.json) e as linhas das tabelas do
 * Supabase, mais o cálculo de "o que mudou" (para mandar só as linhas alteradas).
 * Sem rede e sem Electron: testável no Node puro.
 *
 * O que NÃO vai para a nuvem (preferência de cada computador): módulos escondidos na pesquisa,
 * "já escolhi os módulos", pasta de backup e afins.
 */

const TABELAS = {
  modulos: { chave: 'nome' },
  relatorios: { chave: 'id' },
  colunas_cadastradas: { chave: 'nome' },
  filtros_cadastrados: { chave: 'nome' },
  ignorados: { chave: 'chave' },
};

const copia = (x) => JSON.parse(JSON.stringify(x));

// Cópia profunda de propósito: a "foto" do último estado sincronizado não pode mudar junto
// quando o programa altera um relatório no lugar.
function dbParaLinhas(db) {
  return copia({
    modulos: (db.modulos || []).map((nome, ordem) => ({ nome, ordem })),
    relatorios: (db.relatorios || []).map((r) => ({
      id: r.id,
      modulo: r.modulo,
      nome: r.nome,
      colunas: r.colunas || [],
      filtros: r.filtros || [],
      funcionalidade: r.funcionalidade || null,
      imagem: r.imagem || null,
      imagem_original: r.imagemOriginal || null,
      imagem_filtro: r.imagemFiltro || null,
    })),
    colunas_cadastradas: (db.colunasCadastradas || []).map((nome) => ({ nome })),
    filtros_cadastrados: (db.filtrosCadastrados || []).map((f) => ({ nome: f.nome, tipo: f.tipo || 'texto', opcoes: Array.isArray(f.opcoes) ? f.opcoes : null })),
    ignorados: (db.ignorados || []).map((chave) => ({ chave })),
  });
}

// "base" traz o que é só deste computador (preferências); o resto vem das linhas.
function linhasParaDb(linhas, base) {
  const l = (t) => (Array.isArray(linhas[t]) ? linhas[t] : []);
  return copia({
    ...(base || {}),
    modulos: [...l('modulos')].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((m) => m.nome),
    relatorios: l('relatorios').map((r) => ({
      id: r.id,
      modulo: r.modulo,
      nome: r.nome,
      colunas: Array.isArray(r.colunas) ? r.colunas : [],
      filtros: Array.isArray(r.filtros) ? r.filtros : [],
      funcionalidade: r.funcionalidade || null,
      imagem: r.imagem || null,
      imagemOriginal: r.imagem_original || null,
      imagemFiltro: r.imagem_filtro || null,
    })),
    colunasCadastradas: l('colunas_cadastradas').map((c) => c.nome),
    filtrosCadastrados: l('filtros_cadastrados').map((f) => ({ nome: f.nome, tipo: f.tipo || 'texto', ...(Array.isArray(f.opcoes) ? { opcoes: f.opcoes } : {}) })),
    ignorados: l('ignorados').map((i) => i.chave),
  });
}

// Compara duas "fotos" (saídas de dbParaLinhas) e diz o que precisa ser gravado/apagado na nuvem.
function diffLinhas(antes, depois) {
  const upserts = {};
  const deletes = {};
  for (const [tabela, { chave }] of Object.entries(TABELAS)) {
    const a = new Map((antes[tabela] || []).map((linha) => [linha[chave], JSON.stringify(linha)]));
    const b = new Map((depois[tabela] || []).map((linha) => [linha[chave], linha]));
    const sobem = [];
    const somem = [];
    for (const [k, linha] of b) if (a.get(k) !== JSON.stringify(linha)) sobem.push(linha);
    for (const k of a.keys()) if (!b.has(k)) somem.push(k);
    if (sobem.length) upserts[tabela] = sobem;
    if (somem.length) deletes[tabela] = somem;
  }
  return { upserts, deletes, vazio: !Object.keys(upserts).length && !Object.keys(deletes).length };
}

module.exports = { TABELAS, dbParaLinhas, linhasParaDb, diffLinhas };
