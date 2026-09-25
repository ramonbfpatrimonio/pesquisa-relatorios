'use strict';
(function () {
  const B = window.Busca;
  const Csv = window.Csv;

  const estado = {
    db: null,
    info: null,
    aba: 'pesquisar',
    modulo: '*',
    colunas: [],
    gruposAbertos: new Set(),
    moduloAberto: false,
    relModulo: '*',
    relTexto: '',
    colTexto: '',
    menuOculto: true,
  };

  // Menus que só aparecem depois de liberados com Ctrl+Shift+B e a senha.
  const ABAS_PROTEGIDAS = new Set(['relatorios', 'colunas', 'dados']);
  const SENHA_MENU = '@t1v0ERP10';

  const ABAS = [
    ['pesquisar', 'Pesquisar'],
    ['relatorios', 'Relatórios'],
    ['colunas', 'Colunas'],
    ['dados', 'Dados e backup'],
  ];

  // ---------- utilidades ----------

  // Cria elementos sem innerHTML: nomes de colunas nunca são interpretados como HTML.
  function h(tag, props, ...filhos) {
    const el = document.createElement(tag);
    let valor;
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') valor = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const f of filhos.flat(Infinity)) {
      if (f === null || f === undefined || f === false) continue;
      el.append(f.nodeType ? f : document.createTextNode(String(f)));
    }
    if (valor !== undefined) el.value = valor;
    return el;
  }

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  function formatarData(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function formatarTamanho(bytes) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function aviso(texto, tipo = '', ms = 4200) {
    const el = h('div', { class: `aviso ${tipo}${texto.length > 120 ? ' longo' : ''}` }, texto);
    $('#avisos').append(el);
    setTimeout(() => el.remove(), ms);
  }

  // Caixa de dica única, reaproveitada por todo o app (ex.: o "?" de funcionalidade do relatório).
  // Sempre fica dentro da janela: se não couber embaixo, mostra em cima; se estourar dos lados, encosta na borda.
  const dica = (() => {
    const caixa = h('div', { class: 'dica-flutuante', role: 'tooltip' });
    caixa.hidden = true;
    document.body.append(caixa);
    let alvo = null;
    const MARGEM = 8;

    function posicionar() {
      if (!alvo) return;
      const r = alvo.getBoundingClientRect();
      let esquerda = r.left + r.width / 2 - caixa.offsetWidth / 2;
      esquerda = Math.max(MARGEM, Math.min(esquerda, window.innerWidth - caixa.offsetWidth - MARGEM));
      let topo = r.top - caixa.offsetHeight - MARGEM;
      if (topo < MARGEM) topo = r.bottom + MARGEM; // não coube em cima: mostra embaixo
      topo = Math.max(MARGEM, Math.min(topo, window.innerHeight - caixa.offsetHeight - MARGEM));
      caixa.style.left = `${esquerda}px`;
      caixa.style.top = `${topo}px`;
    }

    function mostrar(el, texto) {
      alvo = el;
      caixa.textContent = texto;
      caixa.hidden = false;
      posicionar();
    }
    function esconder() {
      alvo = null;
      caixa.hidden = true;
    }
    window.addEventListener('scroll', posicionar, true);
    window.addEventListener('resize', posicionar);
    return { mostrar, esconder };
  })();

  // Faixa fixa no rodapé para avisar de atualização disponível/baixada. Fica até a pessoa agir ou dispensar.
  const bannerAtualizacao = (() => {
    const caixa = h('div', { id: 'banner-atualizacao' });
    caixa.hidden = true;
    document.body.append(caixa);
    return {
      mostrar(filhos) {
        caixa.replaceChildren(...filhos);
        caixa.hidden = false;
      },
      esconder() {
        caixa.hidden = true;
      },
    };
  })();

  function tratarEventoAtualizacao(dados) {
    if (dados.tipo === 'disponivel') {
      bannerAtualizacao.mostrar([
        h('span', {}, `Uma nova versão (${dados.versao}) está disponível.`),
        h(
          'button',
          {
            type: 'button',
            class: 'btn pequeno',
            onclick: async (e) => {
              const botao = e.currentTarget;
              botao.disabled = true;
              botao.textContent = 'Baixando…';
              const r = await chamar('baixarAtualizacao');
              if (!r) {
                botao.disabled = false;
                botao.textContent = 'Baixar agora';
              }
            },
          },
          'Baixar agora'
        ),
        h('button', { type: 'button', class: 'btn pequeno discreto', onclick: () => bannerAtualizacao.esconder() }, 'Depois'),
      ]);
    } else if (dados.tipo === 'progresso') {
      bannerAtualizacao.mostrar([h('span', {}, `Baixando atualização… ${dados.percentual}%`)]);
    } else if (dados.tipo === 'baixada') {
      bannerAtualizacao.mostrar([
        h('span', {}, 'Atualização baixada. Reinicie para instalar.'),
        h('button', { type: 'button', class: 'btn pequeno', onclick: () => chamar('instalarAtualizacao') }, 'Reiniciar agora'),
        h('button', { type: 'button', class: 'btn pequeno discreto', onclick: () => bannerAtualizacao.esconder() }, 'Depois'),
      ]);
    }
    // 'nenhuma' e 'erro': não interrompe quem está sem internet ou já atualizado.
  }

  // Chama o processo principal. Devolve { dados } ou null (o erro já aparece na tela).
  async function chamar(nome, ...args) {
    let r;
    try {
      r = await window.api[nome](...args);
    } catch (erro) {
      aviso('Falha ao falar com o programa: ' + erro.message, 'erro', 8000);
      return null;
    }
    if (!r.ok) {
      aviso(r.erro, 'erro', 8000);
      return null;
    }
    return { dados: r.dados };
  }

  function atualizarBanco(db) {
    estado.db = db;
    if (estado.modulo !== '*' && !db.modulos.includes(estado.modulo)) estado.modulo = '*';
    if (estado.relModulo !== '*' && !db.modulos.includes(estado.relModulo)) estado.relModulo = '*';
  }

  // ---------- janelas (modais) ----------

  const pilhaModais = [];

  function abrirModal({ titulo, corpo, acoes = [], larga = false, aoFechar }) {
    const idTitulo = 'modal-' + Math.random().toString(36).slice(2, 8);
    const anterior = document.activeElement;
    let fechado = false;

    const caixa = h('div', { class: 'modal' + (larga ? ' larga' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idTitulo, tabindex: '-1' });
    const fundo = h('div', { class: 'modal-fundo' }, caixa);

    function fechar(chamarAoFechar = true) {
      if (fechado) return;
      fechado = true;
      pilhaModais.splice(pilhaModais.indexOf(controle), 1);
      fundo.remove();
      if (anterior && anterior.focus) anterior.focus();
      if (chamarAoFechar && aoFechar) aoFechar();
    }

    const controle = { fechar, caixa };

    const botoes = acoes.map((a) =>
      h(
        'button',
        {
          type: 'button',
          class: `btn${a.tipo ? ' ' + a.tipo : ''}${a.esquerda ? ' esquerda' : ''}`,
          disabled: !!a.desabilitado,
          onclick: async (e) => {
            const botao = e.currentTarget;
            botao.disabled = true;
            let resultado;
            try {
              resultado = a.aoClicar ? await a.aoClicar() : undefined;
            } finally {
              botao.disabled = false;
            }
            if (resultado !== false) fechar(a.chamarAoFechar === true);
          },
        },
        a.rotulo
      )
    );

    caixa.append(
      h('div', { class: 'modal-cab' }, h('h2', { id: idTitulo }, titulo)),
      h('div', { class: 'modal-corpo' }, corpo),
      h('div', { class: 'modal-acoes' }, botoes)
    );
    $('#camada-modais').append(fundo);
    pilhaModais.push(controle);

    const primeiro = caixa.querySelector('input, select, textarea') || caixa.querySelector('.modal-acoes .btn.primario') || caixa;
    primeiro.focus();
    return controle;
  }

  document.addEventListener('keydown', (e) => {
    const topo = pilhaModais[pilhaModais.length - 1];
    if (!topo) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      topo.fechar();
    } else if (e.key === 'Tab') {
      const foco = [...topo.caixa.querySelectorAll('button:not(:disabled), input, select, textarea, [tabindex="0"]')].filter((x) => !x.hidden);
      if (!foco.length) return;
      const primeiro = foco[0];
      const ultimo = foco[foco.length - 1];
      if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === topo.caixa)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
  });

  function confirmar({ titulo, mensagem, rotulo = 'Confirmar', perigo = false }) {
    return new Promise((resolver) => {
      abrirModal({
        titulo,
        corpo: h('p', {}, mensagem),
        aoFechar: () => resolver(false),
        acoes: [
          { rotulo: 'Cancelar', aoClicar: () => resolver(false) },
          { rotulo, tipo: perigo ? 'perigo' : 'primario', aoClicar: () => resolver(true) },
        ],
      });
    });
  }

  function pedirTexto({ titulo, rotulo, valor = '', ajuda }) {
    return new Promise((resolver) => {
      const campo = h('input', { type: 'text', value: valor, autocomplete: 'off', spellcheck: 'false', id: 'campo-texto' });
      const enviar = () => {
        resolver(campo.value.trim());
        modal.fechar(false);
      };
      campo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          enviar();
        }
      });
      const modal = abrirModal({
        titulo,
        corpo: [h('div', {}, h('label', { class: 'rotulo', for: 'campo-texto' }, rotulo), campo), ajuda ? h('p', { class: 'ajuda' }, ajuda) : null],
        aoFechar: () => resolver(null),
        acoes: [
          { rotulo: 'Cancelar', aoClicar: () => resolver(null) },
          { rotulo: 'Continuar', tipo: 'primario', aoClicar: () => { enviar(); return false; } },
        ],
      });
      campo.select();
    });
  }

  async function verImagem(rel) {
    const r = await chamar('obterImagem', rel.id);
    if (!r) return;
    abrirModal({
      titulo: rel.nome,
      larga: true,
      corpo: r.dados
        ? h('img', { class: 'previa', src: r.dados, alt: `Tela de filtro do relatório ${rel.nome}` })
        : h('p', {}, 'O arquivo da imagem não foi encontrado. Anexe a imagem de novo em Relatórios.'),
      acoes: [{ rotulo: 'Fechar', tipo: 'primario' }],
    });
  }

  // ---------- campo de escolha de colunas ----------

  function criarPicker({ opcoes, valores = [], permitirNovo = false, placeholder = '', aoMudar, rotulo }) {
    let vals = [...valores];
    let itens = [];
    let ativo = -1;
    let aberto = false;
    const idMenu = 'menu-' + Math.random().toString(36).slice(2, 8);

    const entrada = h('input', {
      type: 'text',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-controls': idMenu,
      'aria-expanded': 'false',
      'aria-label': rotulo || 'Colunas',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const menu = h('ul', { class: 'picker-menu', id: idMenu, role: 'listbox', hidden: true });
    const caixa = h('div', { class: 'picker-caixa', onclick: () => entrada.focus() }, entrada);
    const raiz = h('div', { class: 'picker' }, caixa, menu);

    function desenharChips() {
      caixa.querySelectorAll('.chip.editavel').forEach((e) => e.remove());
      for (const v of vals) {
        caixa.insertBefore(
          h(
            'span',
            { class: 'chip editavel' },
            v,
            h('button', { type: 'button', 'aria-label': 'Remover ' + v, onclick: (e) => { e.stopPropagation(); remover(v); entrada.focus(); } }, '×')
          ),
          entrada
        );
      }
      entrada.placeholder = vals.length ? 'Adicionar outra coluna' : placeholder;
    }

    function marcarAtivo(rolar) {
      [...menu.children].forEach((li, i) => {
        li.setAttribute('aria-selected', String(i === ativo));
        if (i === ativo) {
          entrada.setAttribute('aria-activedescendant', li.id);
          if (rolar && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    function desenharMenu() {
      menu.replaceChildren();
      if (!aberto) {
        menu.hidden = true;
        entrada.setAttribute('aria-expanded', 'false');
        return;
      }
      if (!itens.length) {
        menu.append(h('li', { class: 'vazio' }, entrada.value.trim() ? 'Nenhuma coluna com esse nome' : 'Nenhuma coluna disponível'));
      }
      itens.forEach((it, i) => {
        menu.append(
          h(
            'li',
            {
              role: 'option',
              id: `${idMenu}-${i}`,
              class: it.novo ? 'novo' : '',
              'aria-selected': String(i === ativo),
              onmousedown: (e) => { e.preventDefault(); escolher(i); },
              onmousemove: () => { if (ativo !== i) { ativo = i; marcarAtivo(false); } },
            },
            it.novo ? `Criar coluna “${it.nome}”` : [h('span', {}, it.nome), h('small', {}, plural(it.qtd, 'relatório', 'relatórios'))]
          )
        );
      });
      menu.hidden = false;
      entrada.setAttribute('aria-expanded', 'true');
    }

    function atualizarMenu() {
      const texto = entrada.value;
      itens = B.sugerirColunas(opcoes(), texto, new Set(vals), 40);
      const limpo = B.limparNomeColuna(texto);
      if (permitirNovo && limpo && !vals.includes(limpo) && !itens.some((i) => i.nome === limpo)) itens.push({ nome: limpo, novo: true });
      ativo = itens.length ? 0 : -1;
      desenharMenu();
      marcarAtivo(false);
    }

    function abrir() { aberto = true; atualizarMenu(); }
    function fecharMenu() { aberto = false; desenharMenu(); }

    function adicionar(nome) {
      if (!vals.includes(nome)) vals.push(nome);
      entrada.value = '';
      desenharChips();
      if (aberto) atualizarMenu();
      if (aoMudar) aoMudar([...vals]);
    }

    function remover(nome) {
      vals = vals.filter((v) => v !== nome);
      desenharChips();
      if (aberto) atualizarMenu();
      if (aoMudar) aoMudar([...vals]);
    }

    function escolher(i) {
      const it = itens[i];
      if (it) adicionar(it.nome);
    }

    entrada.addEventListener('input', abrir);
    entrada.addEventListener('focus', abrir);
    entrada.addEventListener('blur', fecharMenu);
    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!aberto) return abrir();
        if (!itens.length) return;
        ativo = (ativo + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
        marcarAtivo(true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (aberto && ativo >= 0) escolher(ativo);
      } else if (e.key === 'Escape') {
        if (aberto) {
          e.stopPropagation();
          fecharMenu();
        }
      } else if (e.key === 'Backspace' && !entrada.value && vals.length) {
        remover(vals[vals.length - 1]);
      }
    });

    desenharChips();
    return {
      el: raiz,
      entrada,
      valores: () => [...vals],
      textoPendente: () => entrada.value.trim(),
      definir(novos) { vals = [...novos]; desenharChips(); if (aberto) atualizarMenu(); },
      focar: () => entrada.focus(),
    };
  }

  // ---------- abas ----------

  function montarAbas() {
    const nav = $('#abas');
    const visiveis = ABAS.filter(([id]) => !estado.menuOculto || !ABAS_PROTEGIDAS.has(id));
    nav.replaceChildren(
      ...visiveis.map(([id, nome]) =>
        h('button', { type: 'button', 'data-aba': id, onclick: () => { estado.aba = id; render(); } }, nome)
      )
    );
  }

  // Pede a senha para mostrar Relatórios, Colunas e Dados e backup.
  function pedirSenha() {
    return new Promise((resolver) => {
      const campo = h('input', { type: 'password', id: 'campo-senha', autocomplete: 'off' });
      const enviar = () => { resolver(campo.value); modal.fechar(false); };
      campo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          enviar();
        }
      });
      const modal = abrirModal({
        titulo: 'Liberar menus',
        corpo: [
          h('div', {}, h('label', { class: 'rotulo', for: 'campo-senha' }, 'Senha'), campo),
          h('p', { class: 'ajuda' }, 'Digite a senha para mostrar Relatórios, Colunas e Dados e backup.'),
        ],
        aoFechar: () => resolver(null),
        acoes: [
          { rotulo: 'Cancelar', aoClicar: () => resolver(null) },
          { rotulo: 'Liberar', tipo: 'primario', aoClicar: () => { enviar(); return false; } },
        ],
      });
    });
  }

  // Ctrl+Shift+B: libera os menus escondidos (pede senha) ou esconde de novo (sem senha).
  async function alternarMenu() {
    if (pilhaModais.length) return;
    if (estado.menuOculto) {
      const senha = await pedirSenha();
      if (senha === null) return;
      if (senha !== SENHA_MENU) {
        aviso('Senha incorreta', 'erro');
        return;
      }
      estado.menuOculto = false;
      aviso('Menus liberados');
    } else {
      estado.menuOculto = true;
      if (estado.aba !== 'pesquisar') estado.aba = 'pesquisar';
      aviso('Menus ocultados');
    }
    montarAbas();
    render();
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      alternarMenu();
    }
  });

  function render() {
    for (const b of document.querySelectorAll('#abas button')) {
      if (b.dataset.aba === estado.aba) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    const alvo = $('#conteudo');
    alvo.replaceChildren();
    if (estado.aba === 'pesquisar') renderPesquisa(alvo);
    else if (estado.aba === 'relatorios') renderRelatorios(alvo);
    else if (estado.aba === 'colunas') renderColunas(alvo);
    else renderDados(alvo);
  }

  // ---------- aba Pesquisar ----------

  let ui = {};

  function renderPesquisa(alvo) {
    ui = {};
    ui.segmentos = h('div', { class: 'segmentos', role: 'group', 'aria-label': 'Módulo' });
    ui.segmentos.hidden = !estado.moduloAberto;
    ui.moduloCabecalho = h(
      'button',
      {
        type: 'button',
        class: 'modulo-cabecalho',
        'aria-expanded': String(estado.moduloAberto),
        onclick: () => {
          estado.moduloAberto = !estado.moduloAberto;
          ui.segmentos.hidden = !estado.moduloAberto;
          ui.moduloCabecalho.setAttribute('aria-expanded', String(estado.moduloAberto));
        },
      },
      h('span', { class: 'rotulo' }, 'Módulo'),
      h('span', { class: 'grupo-seta', 'aria-hidden': 'true' }, '▾')
    );
    ui.picker = criarPicker({
      opcoes: () => B.colunasDoEscopo(estado.db.relatorios, estado.modulo),
      valores: estado.colunas,
      placeholder: 'Digite parte do nome da coluna',
      rotulo: 'Colunas que o relatório precisa ter',
      aoMudar: (v) => {
        estado.colunas = v;
        estado.gruposAbertos.clear();
        atualizarPesquisa();
      },
    });
    ui.limpar = h('button', { type: 'button', class: 'btn', onclick: () => { ui.picker.definir([]); estado.colunas = []; estado.gruposAbertos.clear(); atualizarPesquisa(); ui.picker.focar(); } }, 'Limpar colunas');
    ui.exportar = h('button', { type: 'button', class: 'btn', onclick: exportarResultado }, 'Exportar para Excel (CSV)');
    ui.resultados = h('div', { class: 'resultados', tabindex: '-1' });

    const filtros = h(
      'aside',
      { class: 'filtros', 'aria-label': 'Filtros' },
      h('section', {}, h('div', { class: 'modulo-caixa' }, ui.moduloCabecalho, ui.segmentos)),
      h(
        'section',
        {},
        h('span', { class: 'rotulo' }, 'Colunas que o relatório precisa ter'),
        ui.picker.el,
        h('p', { class: 'ajuda' }, 'Escolha uma ou mais. Os relatórios aparecem agrupados por quantas dessas colunas eles têm.')
      ),
      h('div', { class: 'acoes-filtro' }, ui.limpar, ui.exportar)
    );
    alvo.append(h('div', { class: 'pesquisa' }, filtros, ui.resultados));
    atualizarPesquisa();
  }

  function adicionarColuna(nome) {
    if (estado.colunas.includes(nome)) return;
    estado.colunas = [...estado.colunas, nome];
    estado.gruposAbertos.clear();
    ui.picker.definir(estado.colunas);
    atualizarPesquisa();
  }

  function desenharSegmentos() {
    const contar = (m) => estado.db.relatorios.filter((r) => m === '*' || r.modulo === m).length;
    ui.segmentos.replaceChildren(
      ...['*', ...estado.db.modulos].map((m) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(estado.modulo === m),
            onclick: () => {
              estado.modulo = m;
              estado.gruposAbertos.clear();
              atualizarPesquisa();
            },
          },
          h('span', {}, m === '*' ? 'Todos' : m),
          h('small', {}, contar(m))
        )
      )
    );
  }

  let ultimoResultado = null;

  function atualizarPesquisa() {
    desenharSegmentos();
    const resultado = B.pesquisar(estado.db.relatorios, { modulo: estado.modulo, colunas: estado.colunas });
    ultimoResultado = resultado;

    ui.limpar.disabled = !estado.colunas.length;
    ui.exportar.disabled = !resultado.total;

    desenharResultados(resultado);
  }

  function nomeEscopo() {
    return estado.modulo === '*' ? 'todos os módulos' : estado.modulo;
  }

  function vazioPesquisa() {
    const comuns = B.colunasDoEscopo(estado.db.relatorios, estado.modulo).slice(0, 18);
    return h(
      'div',
      { class: 'vazio-pesquisa' },
      h('h1', {}, 'Quais colunas o relatório precisa ter?'),
      h('p', { class: 'ajuda' }, 'Escolha as colunas ao lado e veja quais relatórios trazem todas elas. Também aparecem os que trazem só algumas, do mais próximo ao mais distante.'),
      comuns.length
        ? [
            h('h2', {}, `Colunas mais usadas em ${nomeEscopo()}`),
            h('div', { class: 'sugestoes' }, comuns.map((c) => h('button', { type: 'button', class: 'chip', onclick: () => adicionarColuna(c.nome) }, c.nome, h('small', {}, c.qtd)))),
          ]
        : h('p', { class: 'ajuda' }, `Ainda não há colunas cadastradas em ${nomeEscopo()}.`)
    );
  }

  const LIMITE_COLUNAS_VISIVEIS = 8;

  // As colunas escolhidas vêm primeiro, sempre visíveis, e cada grupo em ordem alfabética;
  // o resto só aparece se a pessoa pedir, para o cartão não virar uma parede de texto.
  function chipsDeColunas(rel, escolhidas) {
    const alfabetica = (arr) => [...arr].sort((a, b) => a.localeCompare(b, 'pt'));
    const hits = alfabetica(rel.colunas.filter((c) => escolhidas.has(c)));
    const resto = alfabetica(rel.colunas.filter((c) => !escolhidas.has(c)));
    const visiveisDeInicio = Math.max(0, LIMITE_COLUNAS_VISIVEIS - hits.length);
    const restoVisivel = resto.slice(0, visiveisDeInicio);
    const restoEscondido = resto.slice(visiveisDeInicio);

    const container = h(
      'div',
      { class: 'rel-colunas' },
      hits.map((c) => h('span', { class: 'chip hit' }, c)),
      restoVisivel.map((c) => h('span', { class: 'chip' }, c))
    );
    if (restoEscondido.length) {
      const chipsEscondidos = restoEscondido.map((c) => h('span', { class: 'chip', hidden: true }, c));
      const rotulo = (aberto) => (aberto ? 'ver menos' : `+${restoEscondido.length} coluna${restoEscondido.length === 1 ? '' : 's'}`);
      const botao = h(
        'button',
        {
          type: 'button',
          class: 'rel-mais',
          onclick: () => {
            const abrir = chipsEscondidos[0].hidden;
            chipsEscondidos.forEach((el) => { el.hidden = !abrir; });
            botao.textContent = rotulo(abrir);
          },
        },
        rotulo(false)
      );
      container.append(...chipsEscondidos, botao);
    }
    return container;
  }

  function linhaRelatorio(item, escolhidas) {
    const { rel } = item;
    return h(
      'article',
      { class: 'rel' },
      h(
        'div',
        { class: 'rel-topo' },
        h('span', { class: 'rel-nome' }, rel.nome),
        h('span', { class: 'rel-modulo' }, rel.modulo),
        rel.imagem ? h('button', { type: 'button', class: 'btn discreto pequeno', onclick: () => verImagem(rel) }, 'Ver tela do filtro') : null
      ),
      rel.colunas.length ? chipsDeColunas(rel, escolhidas) : h('p', { class: 'rel-sem-colunas' }, 'Sem colunas cadastradas.'),
      rel.funcionalidade
        ? h(
            'div',
            { class: 'rel-rodape' },
            h(
              'span',
              {
                class: 'rel-ajuda',
                tabindex: '0',
                'aria-label': `Para que serve ${rel.nome}: ${rel.funcionalidade}`,
                onmouseenter: (e) => dica.mostrar(e.currentTarget, rel.funcionalidade),
                onmouseleave: () => dica.esconder(),
                onfocus: (e) => dica.mostrar(e.currentTarget, rel.funcionalidade),
                onblur: () => dica.esconder(),
              },
              '?'
            )
          )
        : null
    );
  }

  function desenharResultados(resultado) {
    const alvo = ui.resultados;
    alvo.replaceChildren();
    const n = estado.colunas.length;
    if (!n) {
      alvo.append(vazioPesquisa());
      return;
    }

    const melhor = resultado.grupos[0];
    let titulo;
    let subtitulo = null;
    if (!resultado.total) {
      titulo = 'Nenhum relatório tem essas colunas';
      subtitulo = `Tire alguma coluna${estado.modulo === '*' ? '' : ' ou pesquise em Todos os módulos'} para ampliar a busca.`;
    } else if (melhor.acertos === n) {
      const q = melhor.itens.length;
      titulo = `${q} ${q === 1 ? 'relatório tem' : 'relatórios têm'} ${n === 1 ? 'a coluna escolhida' : `todas as ${n} colunas`}`;
      if (n > 1) subtitulo = `${resultado.total} no total têm pelo menos uma delas. Pesquisando em ${nomeEscopo()}.`;
      else subtitulo = `Pesquisando em ${nomeEscopo()}.`;
    } else {
      titulo = `Nenhum relatório tem as ${n} colunas juntas`;
      subtitulo = `Os mais próximos têm ${melhor.acertos} de ${n}. Pesquisando em ${nomeEscopo()}.`;
    }

    alvo.append(h('div', { class: 'resultados-topo' }, h('div', {}, h('h1', {}, titulo), subtitulo ? h('p', { class: 'ajuda' }, subtitulo) : null)));

    const escolhidas = new Set(estado.colunas);
    for (const g of resultado.grupos) {
      const aberto = estado.gruposAbertos.has(g.acertos);
      alvo.append(
        h(
          'section',
          { class: 'grupo' },
          h(
            'button',
            {
              type: 'button',
              class: 'grupo-cabecalho',
              'aria-expanded': String(aberto),
              onclick: () => {
                if (aberto) estado.gruposAbertos.delete(g.acertos);
                else estado.gruposAbertos.add(g.acertos);
                desenharResultados(resultado);
              },
            },
            h('span', { class: 'placar' }, `${g.acertos}/${n}`),
            h('h2', {}, g.acertos === n ? (n === 1 ? 'Têm a coluna' : `Têm todas as ${n} colunas`) : `Têm ${g.acertos} das ${n} colunas`),
            h('span', { class: 'ajuda' }, plural(g.itens.length, 'relatório', 'relatórios')),
            h('span', { class: 'grupo-seta', 'aria-hidden': 'true' }, '▾')
          ),
          aberto ? h('div', { class: 'grupo-corpo' }, g.itens.map((it) => linhaRelatorio(it, escolhidas))) : null
        )
      );
    }
  }

  async function exportarResultado() {
    if (!ultimoResultado || !ultimoResultado.total) return;
    const csv = B.gerarCSV(ultimoResultado, estado.colunas);
    const r = await chamar('exportarCSV', csv);
    if (r && r.dados) aviso('Arquivo salvo: ' + r.dados);
  }

  // ---------- aba Relatórios ----------

  function renderRelatorios(alvo) {
    const tabela = h('div', {});
    const contagem = h('span', { class: 'contagem' });

    const selModulo = h(
      'select',
      {
        'aria-label': 'Filtrar por módulo',
        onchange: (e) => { estado.relModulo = e.target.value; render(); },
      },
      h('option', { value: '*' }, 'Todos os módulos'),
      estado.db.modulos.map((m) => h('option', { value: m }, m))
    );
    selModulo.value = estado.relModulo;

    const busca = h('input', {
      type: 'search',
      class: 'crescer',
      placeholder: 'Buscar pelo nome do relatório',
      'aria-label': 'Buscar pelo nome do relatório',
      value: estado.relTexto,
      oninput: (e) => { estado.relTexto = e.target.value; desenharTabela(); },
    });

    const vazioModulo = estado.relModulo !== '*' && !estado.db.relatorios.some((r) => r.modulo === estado.relModulo);

    function desenharTabela() {
      const texto = B.normalizarBusca(estado.relTexto);
      const lista = estado.db.relatorios
        .filter((r) => estado.relModulo === '*' || r.modulo === estado.relModulo)
        .filter((r) => !texto || B.normalizarBusca(r.nome).includes(texto))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
      contagem.textContent = plural(lista.length, 'relatório', 'relatórios');
      if (!lista.length) {
        tabela.replaceChildren(h('div', { class: 'tabela-vazia' }, texto ? 'Nenhum relatório com esse nome.' : 'Nenhum relatório neste módulo ainda. Use “Novo relatório” para cadastrar o primeiro.'));
        return;
      }
      tabela.replaceChildren(
        h(
          'table',
          { class: 'tabela' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Relatório'), h('th', {}, 'Módulo'), h('th', { class: 'num' }, 'Colunas'), h('th', {}, 'Tela do filtro'))),
          h(
            'tbody',
            {},
            lista.map((r) =>
              h(
                'tr',
                { class: 'clicavel', onclick: () => editarRelatorio(r) },
                h('td', {}, h('button', { type: 'button', class: 'link', onclick: (e) => { e.stopPropagation(); editarRelatorio(r); } }, r.nome)),
                h('td', { class: 'mono' }, r.modulo),
                h('td', { class: 'num' }, r.colunas.length),
                h('td', {}, r.imagem ? h('span', { class: 'tag auto' }, 'Anexada') : '')
              )
            )
          )
        )
      );
    }

    alvo.append(
      h(
        'div',
        { class: 'tela' },
        h(
          'div',
          { class: 'tela-larga' },
          h('h1', {}, 'Relatórios'),
          h('p', { class: 'ajuda' }, 'Cadastre, edite e exclua relatórios e as colunas de cada um. Tudo o que muda aqui já vale na pesquisa.'),
          h(
            'div',
            { class: 'barra' },
            selModulo,
            busca,
            h('button', { type: 'button', class: 'btn primario', onclick: () => editarRelatorio(null) }, 'Novo relatório'),
            h('button', { type: 'button', class: 'btn', onclick: novoModulo }, 'Novo módulo'),
            vazioModulo ? h('button', { type: 'button', class: 'btn perigo', onclick: () => excluirModulo(estado.relModulo) }, `Excluir módulo ${estado.relModulo}`) : null,
            contagem
          ),
          tabela
        )
      )
    );
    desenharTabela();
  }

  async function novoModulo() {
    const nome = await pedirTexto({ titulo: 'Novo módulo', rotulo: 'Nome do módulo', ajuda: 'Exemplo: ATIVO_ECD. Espaços viram “_”.' });
    if (!nome) return;
    const r = await chamar('adicionarModulo', nome);
    if (!r) return;
    atualizarBanco(r.dados);
    aviso('Módulo criado');
    render();
  }

  async function excluirModulo(nome) {
    if (!(await confirmar({ titulo: 'Excluir módulo', mensagem: `Excluir o módulo ${nome}? Ele não tem nenhum relatório.`, rotulo: 'Excluir módulo', perigo: true }))) return;
    const r = await chamar('excluirModulo', nome);
    if (!r) return;
    atualizarBanco(r.dados);
    aviso('Módulo excluído');
    render();
  }

  function editarRelatorio(rel) {
    const novo = !rel;
    const campoNome = h('input', { type: 'text', id: 'campo-nome', value: rel ? rel.nome : '', autocomplete: 'off' });
    const selModulo = h('select', { id: 'campo-modulo' }, estado.db.modulos.map((m) => h('option', { value: m }, m)));
    selModulo.value = rel ? rel.modulo : estado.relModulo !== '*' ? estado.relModulo : estado.db.modulos[0];

    const picker = criarPicker({
      opcoes: () => B.colunasDoEscopo(estado.db.relatorios, '*'),
      valores: rel ? rel.colunas : [],
      permitirNovo: true,
      placeholder: 'Digite para buscar ou criar uma coluna',
      rotulo: 'Colunas do relatório',
    });

    const campoFuncionalidade = h('textarea', {
      id: 'campo-funcionalidade',
      rows: '3',
      placeholder: 'Ex.: cheques recebidos de cada cliente, ordenados pela data de vencimento.',
      value: rel && rel.funcionalidade ? rel.funcionalidade : '',
    });

    // Imagem da tela de filtro (só depois que o relatório existe).
    let blocoImagem = null;
    if (!novo) {
      const area = h('div', { class: 'imagem-campo' });
      const desenharImagem = async () => {
        const atual = estado.db.relatorios.find((r) => r.id === rel.id);
        area.replaceChildren();
        if (atual && atual.imagem) {
          const r = await chamar('obterImagem', rel.id);
          if (r && r.dados) area.append(h('img', { class: 'previa', src: r.dados, alt: 'Tela de filtro anexada' }));
          else area.append(h('p', { class: 'ajuda' }, 'A imagem anexada não foi encontrada no disco. Anexe de novo.'));
        } else if (atual && atual.imagemOriginal) {
          area.append(h('p', { class: 'ajuda' }, `Na planilha original este relatório apontava para “${atual.imagemOriginal}”.`));
        }
        area.append(
          h(
            'div',
            { class: 'barra', role: 'group' },
            h('button', {
              type: 'button',
              class: 'btn pequeno',
              onclick: async () => {
                const r = await chamar('anexarImagem', rel.id);
                if (r && r.dados) { atualizarBanco(r.dados); aviso('Imagem anexada'); desenharImagem(); }
              },
            }, atual && atual.imagem ? 'Trocar imagem' : 'Anexar imagem'),
            atual && atual.imagem
              ? h('button', {
                  type: 'button',
                  class: 'btn pequeno perigo',
                  onclick: async () => {
                    const r = await chamar('removerImagem', rel.id);
                    if (r) { atualizarBanco(r.dados); aviso('Imagem removida'); desenharImagem(); }
                  },
                }, 'Remover imagem')
              : null
          )
        );
      };
      blocoImagem = h('div', {}, h('span', { class: 'rotulo' }, 'Tela do filtro (imagem)'), area, h('p', { class: 'ajuda' }, 'A imagem é salva assim que você escolhe o arquivo.'));
      desenharImagem();
    }

    abrirModal({
      titulo: novo ? 'Novo relatório' : 'Editar relatório',
      larga: true,
      corpo: [
        h('div', {}, h('label', { class: 'rotulo', for: 'campo-nome' }, 'Nome do relatório'), campoNome),
        h('div', {}, h('label', { class: 'rotulo', for: 'campo-modulo' }, 'Módulo'), selModulo),
        h('div', {}, h('span', { class: 'rotulo' }, 'Colunas'), picker.el, h('p', { class: 'ajuda' }, 'Escolha colunas que já existem ou digite um nome novo e pressione Enter. Nomes novos ficam em maiúsculas.')),
        h(
          'div',
          {},
          h('label', { class: 'rotulo', for: 'campo-funcionalidade' }, 'Para que serve (opcional)'),
          campoFuncionalidade,
          h('p', { class: 'ajuda' }, 'Esse texto aparece no ícone de interrogação dos resultados da pesquisa.')
        ),
        blocoImagem,
      ],
      acoes: [
        !novo
          ? {
              rotulo: 'Excluir relatório',
              tipo: 'perigo',
              esquerda: true,
              aoClicar: async () => {
                if (!(await confirmar({ titulo: 'Excluir relatório', mensagem: `Excluir “${rel.nome}”? Você pode recuperar depois restaurando um backup.`, rotulo: 'Excluir', perigo: true }))) return false;
                const r = await chamar('excluirRelatorio', rel.id);
                if (!r) return false;
                atualizarBanco(r.dados);
                aviso('Relatório excluído');
                render();
              },
            }
          : null,
        { rotulo: 'Cancelar' },
        {
          rotulo: 'Salvar',
          tipo: 'primario',
          aoClicar: async () => {
            if (picker.textoPendente()) {
              aviso(`Você digitou “${picker.textoPendente()}” mas não adicionou. Pressione Enter para adicionar a coluna ou apague o texto.`, 'erro', 7000);
              picker.focar();
              return false;
            }
            const r = await chamar('salvarRelatorio', {
              id: rel ? rel.id : undefined,
              nome: campoNome.value,
              modulo: selModulo.value,
              colunas: picker.valores(),
              funcionalidade: campoFuncionalidade.value,
            });
            if (!r) return false;
            atualizarBanco(r.dados);
            aviso(novo ? 'Relatório criado' : 'Relatório salvo');
            render();
          },
        },
      ].filter(Boolean),
    });
  }

  // ---------- aba Colunas ----------

  async function unificar(de, para) {
    const qtd = estado.db.relatorios.filter((r) => r.colunas.includes(de)).length;
    if (!(await confirmar({ titulo: 'Unificar colunas', mensagem: `Trocar ${de} por ${para} em ${plural(qtd, 'relatório', 'relatórios')}?`, rotulo: 'Unificar' }))) return;
    await aplicarRenomear(de, para);
  }

  async function aplicarRenomear(de, para) {
    const r = await chamar('renomearColuna', de, para);
    if (!r) return;
    atualizarBanco(r.dados.db);
    const novo = B.limparNomeColuna(para);
    estado.colunas = [...new Set(estado.colunas.map((c) => (c === de ? novo : c)))];
    aviso(`${plural(r.dados.alterados, 'relatório atualizado', 'relatórios atualizados')}`);
    render();
  }

  async function renomear(nome) {
    const digitado = await pedirTexto({
      titulo: 'Renomear coluna',
      rotulo: 'Novo nome',
      valor: nome,
      ajuda: 'A mudança vale em todos os relatórios. Se o nome já existir, as duas colunas viram uma só.',
    });
    if (digitado === null) return;
    const novo = B.limparNomeColuna(digitado);
    if (!novo || novo === nome) return;
    const existente = B.colunasDoEscopo(estado.db.relatorios, '*').find((c) => c.nome === novo);
    if (existente) {
      const ok = await confirmar({
        titulo: 'Unificar colunas',
        mensagem: `Já existe uma coluna ${novo}, usada em ${plural(existente.qtd, 'relatório', 'relatórios')}. Unificar as duas?`,
        rotulo: 'Unificar',
      });
      if (!ok) return;
    }
    await aplicarRenomear(nome, novo);
  }

  function renderColunas(alvo) {
    const pares = B.colunasSimilares(estado.db.relatorios, estado.db.ignorados);
    const tabela = h('div', {});
    const contagem = h('span', { class: 'contagem' });

    const painelSimilares = h(
      'section',
      { class: 'similares' },
      h('h2', {}, 'Nomes parecidos'),
      h('p', { class: 'ajuda' }, pares.length ? 'Estas colunas podem ser a mesma escrita de jeitos diferentes. Enquanto estiverem separadas, a pesquisa não junta os relatórios delas.' : 'Nenhum par de nomes parecidos encontrado.'),
      pares.map((p) => {
        const maior = p.qb > p.qa ? p.b : p.a;
        const menor = maior === p.a ? p.b : p.a;
        return h(
          'div',
          { class: 'par' },
          h(
            'div',
            { class: 'par-nomes' },
            h('span', { class: 'chip' }, p.a),
            h('span', { class: 'ajuda' }, plural(p.qa, 'relatório', 'relatórios')),
            h('span', { class: 'ajuda' }, 'e'),
            h('span', { class: 'chip' }, p.b),
            h('span', { class: 'ajuda' }, plural(p.qb, 'relatório', 'relatórios'))
          ),
          h(
            'div',
            { class: 'par-acoes' },
            h('button', { type: 'button', class: 'btn pequeno primario', onclick: () => unificar(menor, maior) }, `Unificar em ${maior}`),
            h('button', { type: 'button', class: 'btn pequeno', onclick: () => unificar(maior, menor) }, `Unificar em ${menor}`),
            h('button', {
              type: 'button',
              class: 'btn pequeno discreto',
              onclick: async () => {
                const r = await chamar('ignorarSimilar', p.chave);
                if (r) { atualizarBanco(r.dados); render(); }
              },
            }, 'São diferentes')
          )
        );
      })
    );

    const busca = h('input', {
      type: 'search',
      class: 'crescer',
      placeholder: 'Buscar coluna',
      'aria-label': 'Buscar coluna',
      value: estado.colTexto,
      oninput: (e) => { estado.colTexto = e.target.value; desenharTabela(); },
    });

    const todas = B.estatisticasColunas(estado.db.relatorios);

    function desenharTabela() {
      const texto = B.normalizarBusca(estado.colTexto);
      const lista = todas.filter((c) => !texto || B.normalizarBusca(c.nome).includes(texto));
      contagem.textContent = plural(lista.length, 'coluna', 'colunas');
      if (!lista.length) {
        tabela.replaceChildren(h('div', { class: 'tabela-vazia' }, 'Nenhuma coluna com esse nome.'));
        return;
      }
      tabela.replaceChildren(
        h(
          'table',
          { class: 'tabela' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Coluna'), h('th', {}, 'Módulos'), h('th', { class: 'num' }, 'Relatórios'), h('th', {}, ''))),
          h(
            'tbody',
            {},
            lista.map((c) =>
              h(
                'tr',
                {},
                h('td', { class: 'mono' }, c.nome),
                h('td', { class: 'ajuda' }, c.modulos.join(', ')),
                h('td', { class: 'num' }, c.qtd),
                h(
                  'td',
                  { class: 'acoes' },
                  h('button', { type: 'button', class: 'btn pequeno discreto', onclick: () => { estado.aba = 'pesquisar'; estado.modulo = '*'; estado.colunas = [c.nome]; estado.gruposAbertos.clear(); render(); } }, 'Ver relatórios'),
                  h('button', { type: 'button', class: 'btn pequeno discreto', onclick: () => renomear(c.nome) }, 'Renomear')
                )
              )
            )
          )
        )
      );
    }

    alvo.append(
      h(
        'div',
        { class: 'tela' },
        h(
          'div',
          { class: 'tela-larga' },
          h('h1', {}, 'Colunas'),
          h('p', { class: 'ajuda' }, 'Renomear uma coluna vale para todos os relatórios que a usam.'),
          painelSimilares,
          h('div', { class: 'barra' }, busca, contagem),
          tabela
        )
      )
    );
    desenharTabela();
  }

  // ---------- aba Dados e backup ----------

  const TIPOS_BACKUP = {
    auto: 'Automático',
    manual: 'Manual',
    'antes-de-restaurar': 'Antes de restaurar',
    'antes-de-importar': 'Antes de importar',
  };

  // ---------- importação de relatórios em lote (CSV) ----------

  // Compara os dados do CSV com o banco atual: decide se cada linha é relatório novo,
  // atualização de um que já existe, ou tem erro. Resolve duplicata dentro do próprio
  // arquivo (mesmo módulo + nome em duas linhas): fica só a última, nunca as duas.
  function classificarLinhasCSV(linhas, db) {
    const chaveNome = (s) => B.semAcento(String(s)).toLowerCase().replace(/\s+/g, ' ').trim();
    const vistos = new Map();
    const resultado = [];
    const avisos = [];
    for (const linha of linhas) {
      if (linha.erros.length) {
        resultado.push({ ...linha, status: 'erro' });
        continue;
      }
      const chave = linha.modulo.toUpperCase() + '|' + chaveNome(linha.nome);
      if (vistos.has(chave)) {
        const i = vistos.get(chave);
        avisos.push(`As linhas ${resultado[i].numeroLinha} e ${linha.numeroLinha} são o mesmo relatório (“${linha.nome}” em ${linha.modulo}) — só a linha ${linha.numeroLinha} vai ser importada.`);
        resultado[i] = { ...resultado[i], status: 'substituida' };
      }
      const existe = db.relatorios.some((r) => r.modulo === linha.modulo && chaveNome(r.nome) === chaveNome(linha.nome));
      const moduloNovo = !db.modulos.includes(linha.modulo);
      vistos.set(chave, resultado.length);
      resultado.push({ ...linha, status: existe ? 'atualiza' : 'novo', moduloNovo });
    }
    return { linhas: resultado, avisos };
  }

  function abrirGuiaImportacaoCSV() {
    abrirModal({
      titulo: 'Importar relatórios de uma planilha (CSV)',
      larga: true,
      corpo: [
        h('p', {}, 'O arquivo precisa ter estas colunas na primeira linha (a ordem entre elas não importa):'),
        h(
          'ul', {},
          h('li', {}, h('b', {}, 'MODULO'), ' — o módulo do relatório. Se ainda não existir, é criado sozinho.'),
          h('li', {}, h('b', {}, 'NOME'), ' — o nome do relatório.'),
          h('li', {}, h('b', {}, 'FUNCIONALIDADE'), ' — para que ele serve. Pode deixar em branco.'),
          h('li', {}, h('b', {}, 'COLUNAS'), ' — todas as colunas do relatório numa célula só, separadas por ponto e vírgula ( ; ).')
        ),
        h('p', {}, 'Uma linha por relatório. Se já existir um relatório com o mesmo nome nesse módulo, as colunas e a funcionalidade dele são atualizadas (nada duplica).'),
        h('p', { class: 'rotulo' }, 'Exemplo:'),
        h('pre', { class: 'exemplo-csv' }, 'MODULO;NOME;FUNCIONALIDADE;COLUNAS\nATIVO_LOG;Vendas por Vendedor;Mostra o total vendido por vendedor.;"VENDEDOR;VALOR;DATA;CLIENTE"'),
        h('p', { class: 'ajuda' }, 'Pode salvar do Excel com vírgula ou com ponto e vírgula separando as colunas — o programa reconhece sozinho. Se algum texto tiver acento e vier estranho, tente salvar como “CSV UTF-8”.'),
      ],
      acoes: [
        {
          rotulo: 'Baixar modelo (.csv)',
          esquerda: true,
          aoClicar: async () => {
            const r = await chamar('baixarModeloRelatoriosCSV');
            if (r && r.dados) aviso('Modelo salvo: ' + r.dados);
            return false;
          },
        },
        { rotulo: 'Cancelar' },
        { rotulo: 'Escolher arquivo…', tipo: 'primario', aoClicar: () => escolherEValidarCSV() },
      ],
    });
  }

  async function escolherEValidarCSV() {
    const r = await chamar('lerRelatoriosCSV');
    if (!r || !r.dados) return;
    const analise = Csv.analisarCSV(r.dados.conteudo);
    if (!analise.ok) {
      aviso(analise.erroGeral, 'erro', 10000);
      return;
    }
    const { linhas, avisos } = classificarLinhasCSV(analise.linhas, estado.db);
    abrirPreviaImportacaoCSV({ nomeArquivo: r.dados.nomeArquivo, linhas, avisos });
  }

  const RECADO_STATUS = { novo: 'Novo', atualiza: 'Atualiza', erro: 'Erro' };

  function abrirPreviaImportacaoCSV({ nomeArquivo, linhas, avisos }) {
    const validas = linhas.filter((l) => l.status === 'novo' || l.status === 'atualiza');
    const novos = validas.filter((l) => l.status === 'novo').length;
    const atualiza = validas.filter((l) => l.status === 'atualiza').length;
    const comErro = linhas.filter((l) => l.status === 'erro');
    const modulosNovos = new Set(validas.filter((l) => l.moduloNovo).map((l) => l.modulo));
    const visiveis = linhas.filter((l) => l.status !== 'substituida');

    abrirModal({
      titulo: 'Confirmar importação',
      larga: true,
      corpo: [
        h('p', {}, `Arquivo: ${nomeArquivo} — ${plural(linhas.length, 'linha', 'linhas')} de relatório.`),
        h(
          'div',
          { class: 'numeros' },
          h('div', {}, h('b', {}, novos), h('span', {}, 'novos')),
          h('div', {}, h('b', {}, atualiza), h('span', {}, 'atualizados')),
          h('div', {}, h('b', {}, modulosNovos.size), h('span', {}, 'módulos novos')),
          h('div', {}, h('b', {}, comErro.length), h('span', {}, 'com erro'))
        ),
        avisos.length ? h('div', {}, avisos.map((a) => h('p', { class: 'ajuda' }, a))) : null,
        h(
          'div',
          { class: 'previa-csv' },
          h(
            'table',
            { class: 'tabela' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Linha'), h('th', {}, 'Módulo'), h('th', {}, 'Relatório'), h('th', {}, 'Colunas'), h('th', {}, 'Situação'))),
            h(
              'tbody',
              {},
              visiveis.map((l) =>
                h(
                  'tr',
                  {},
                  h('td', { class: 'num' }, l.numeroLinha),
                  h('td', { class: 'mono' }, l.modulo || '—'),
                  h('td', {}, l.nome || '—'),
                  h('td', {}, l.status === 'erro' ? l.erros.join(', ') : plural(l.colunas.length, 'coluna', 'colunas')),
                  h('td', {}, h('span', { class: 'tag' + (l.status === 'novo' ? ' auto' : l.status === 'erro' ? ' perigo' : '') }, RECADO_STATUS[l.status]))
                )
              )
            )
          )
        ),
      ],
      acoes: [
        { rotulo: 'Cancelar' },
        {
          rotulo: validas.length ? `Importar ${validas.length} ${validas.length === 1 ? 'relatório' : 'relatórios'}` : 'Nada para importar',
          tipo: 'primario',
          desabilitado: !validas.length,
          aoClicar: async () => {
            const payload = validas.map((l) => ({ modulo: l.modulo, nome: l.nome, funcionalidade: l.funcionalidade, colunas: l.colunas }));
            const r = await chamar('importarRelatoriosCSV', payload);
            if (!r) return false;
            atualizarBanco(r.dados.db);
            const partes = [`${r.dados.novos} novo(s)`, `${r.dados.atualizados} atualizado(s)`];
            if (r.dados.novosModulos) partes.push(`${r.dados.novosModulos} módulo(s) novo(s)`);
            aviso('Importação concluída: ' + partes.join(', ') + '.', '', 7000);
            render();
          },
        },
      ],
    });
  }

  function renderDados(alvo) {
    const colunas = new Set();
    estado.db.relatorios.forEach((r) => r.colunas.forEach((c) => colunas.add(c)));
    const listaBackups = h('div', {}, h('p', { class: 'ajuda' }, 'Carregando backups…'));

    async function carregarBackups() {
      const r = await chamar('listarBackups');
      if (!r) return;
      desenharBackups(r.dados);
    }

    function desenharBackups(backups) {
      if (!backups.length) {
        listaBackups.replaceChildren(h('div', { class: 'tabela-vazia' }, 'Ainda não há backups nesta pasta. Use “Fazer backup agora”.'));
        return;
      }
      listaBackups.replaceChildren(
        h(
          'table',
          { class: 'tabela' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Data'), h('th', {}, 'Tipo'), h('th', { class: 'num' }, 'Tamanho'), h('th', {}, ''))),
          h(
            'tbody',
            {},
            backups.slice(0, 60).map((b) =>
              h(
                'tr',
                {},
                h('td', {}, formatarData(b.data)),
                h('td', {}, h('span', { class: 'tag' + (b.tipo === 'auto' ? ' auto' : '') }, TIPOS_BACKUP[b.tipo] || b.tipo)),
                h('td', { class: 'num' }, formatarTamanho(b.tamanho)),
                h('td', { class: 'acoes' }, h('button', { type: 'button', class: 'btn pequeno', onclick: () => restaurar(b) }, 'Restaurar'))
              )
            )
          )
        )
      );
    }

    async function restaurar(b) {
      const ok = await confirmar({
        titulo: 'Restaurar backup',
        mensagem: `Voltar os dados para o backup de ${formatarData(b.data)}? O que está no programa agora será guardado em um backup antes.`,
        rotulo: 'Restaurar',
      });
      if (!ok) return;
      const r = await chamar('restaurarBackup', b.nome);
      if (!r) return;
      atualizarBanco(r.dados);
      aviso('Backup restaurado');
      render();
    }

    const caminho = (rotulo, valor, botoes) =>
      h('div', { class: 'pasta' }, h('span', { class: 'rotulo' }, rotulo), h('code', {}, valor), h('div', { class: 'barra' }, botoes));

    alvo.append(
      h(
        'div',
        { class: 'tela' },
        h(
          'div',
          { class: 'tela-larga' },
          h('h1', {}, 'Dados e backup'),
          h('p', { class: 'ajuda' }, 'Tudo fica salvo neste computador. Não é preciso internet nem conta.'),
          h(
            'div',
            { class: 'numeros' },
            h('div', {}, h('b', {}, estado.db.relatorios.length), h('span', {}, 'relatórios')),
            h('div', {}, h('b', {}, colunas.size), h('span', {}, 'colunas diferentes')),
            h('div', {}, h('b', {}, estado.db.modulos.length), h('span', {}, 'módulos')),
            h('div', {}, h('b', {}, formatarData(estado.db.atualizadoEm)), h('span', {}, 'última alteração'))
          ),
          h(
            'section',
            { class: 'painel' },
            h('h2', {}, 'Onde ficam os arquivos'),
            caminho('Dados', estado.info.pastaDados, [h('button', { type: 'button', class: 'btn pequeno', onclick: () => chamar('abrirPastaDados') }, 'Abrir pasta')]),
            caminho('Backups', estado.info.pastaBackup, [
              h('button', { type: 'button', class: 'btn pequeno', onclick: () => chamar('abrirPastaBackup') }, 'Abrir pasta'),
              h('button', {
                type: 'button',
                class: 'btn pequeno',
                onclick: async () => {
                  const r = await chamar('escolherPastaBackup');
                  if (r && r.dados) { estado.info = { ...estado.info, ...r.dados.info }; aviso('Pasta de backup alterada. Um backup já foi feito nela.'); render(); }
                },
              }, 'Trocar pasta'),
            ]),
            h('p', { class: 'ajuda' }, 'Um backup automático é feito ao abrir o programa, a cada 10 minutos quando há mudanças e ao fechar. Os 40 automáticos mais recentes são mantidos; os manuais nunca são apagados. Dica: aponte a pasta de backup para o OneDrive ou um pendrive.')
          ),
          h(
            'section',
            { class: 'painel' },
            h('div', { class: 'barra' }, h('h2', { class: 'crescer' }, 'Backups'), h('button', {
              type: 'button',
              class: 'btn primario',
              onclick: async () => {
                const r = await chamar('criarBackup');
                if (r) { aviso('Backup criado'); desenharBackups(r.dados.backups); }
              },
            }, 'Fazer backup agora')),
            listaBackups
          ),
          h(
            'section',
            { class: 'painel' },
            h('h2', {}, 'Exportar e importar'),
            h('p', { class: 'ajuda' }, 'Use para levar os dados a outro computador. As imagens das telas de filtro não vão no arquivo de dados; copie a pasta de backup inteira se precisar delas.'),
            h(
              'div',
              { class: 'barra' },
              h('button', {
                type: 'button',
                class: 'btn',
                onclick: async () => {
                  const r = await chamar('exportarJSON');
                  if (r && r.dados) aviso('Arquivo salvo: ' + r.dados);
                },
              }, 'Exportar dados (JSON)'),
              h('button', {
                type: 'button',
                class: 'btn',
                onclick: async () => {
                  const ok = await confirmar({ titulo: 'Importar dados', mensagem: 'Importar substitui todos os relatórios atuais pelos do arquivo. Um backup dos dados atuais é feito antes.', rotulo: 'Escolher arquivo' });
                  if (!ok) return;
                  const r = await chamar('importarJSON');
                  if (r && r.dados) { atualizarBanco(r.dados); aviso('Dados importados'); render(); }
                },
              }, 'Importar dados (JSON)'),
              h('button', {
                type: 'button',
                class: 'btn',
                onclick: async () => {
                  const r = await chamar('importarImagensDePasta');
                  if (r && r.dados) {
                    atualizarBanco(r.dados.db);
                    aviso(`${plural(r.dados.associadas, 'imagem ligada', 'imagens ligadas')} aos relatórios. ${r.dados.semArquivo ? plural(r.dados.semArquivo, 'relatório continua', 'relatórios continuam') + ' sem imagem.' : ''}`, '', 7000);
                    render();
                  }
                },
              }, 'Importar imagens de uma pasta'),
              h('button', { type: 'button', class: 'btn', onclick: () => abrirGuiaImportacaoCSV() }, 'Importar relatórios (CSV)')
            ),
            h('p', { class: 'ajuda' }, 'Importar imagens: escolha a pasta “IMAGENS FILTRO RELAORIOS ADM”. O programa liga cada arquivo ao relatório que a planilha original apontava.')
          ),
          h(
            'section',
            { class: 'painel' },
            h('h2', {}, 'Atualizações'),
            h('p', { class: 'ajuda' }, `Versão instalada: ${estado.info.versao}. O programa confere sozinho por uma versão nova ao abrir; use o botão abaixo para checar na hora.`),
            h(
              'button',
              {
                type: 'button',
                class: 'btn',
                onclick: async (e) => {
                  const botao = e.currentTarget;
                  botao.disabled = true;
                  const r = await chamar('verificarAtualizacoes');
                  botao.disabled = false;
                  if (r && r.dados && r.dados.emDesenvolvimento) aviso('Atualização automática só funciona no programa instalado, não neste modo de desenvolvimento.');
                  else if (r) aviso('Verificando… se houver uma versão nova, um aviso aparece na tela.');
                },
              },
              'Verificar atualizações'
            )
          )
        )
      )
    );
    carregarBackups();
  }

  // ---------- início ----------

  const INICIO_CARREGAMENTO = Date.now();

  // O preloader fica visível pelo menos esse tanto de tempo, para não "piscar" em máquinas rápidas.
  function esconderPreloader() {
    const preloader = document.getElementById('preloader');
    if (!preloader) return;
    const minimo = 900;
    const espera = Math.max(0, minimo - (Date.now() - INICIO_CARREGAMENTO));
    setTimeout(() => {
      preloader.classList.add('saiu');
      setTimeout(() => preloader.remove(), 500);
    }, espera);
  }

  async function iniciar() {
    const r = await window.api.carregar();
    if (!r.ok) {
      document.body.replaceChildren(h('p', { class: 'tela' }, 'Não foi possível abrir os dados: ' + r.erro));
      esconderPreloader();
      return;
    }
    estado.db = r.dados.db;
    estado.info = r.dados.info;
    const elVersao = document.getElementById('versao-app');
    if (elVersao) elVersao.textContent = `v${estado.info.versao}`;
    montarAbas();
    render();
    esconderPreloader();
    if (estado.info.avisoInicial) aviso(estado.info.avisoInicial, 'erro', 20000);
    if (typeof window.api.aoAtualizar === 'function') window.api.aoAtualizar(tratarEventoAtualizacao);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
