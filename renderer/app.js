'use strict';
(function () {
  const B = window.Busca;
  const Csv = window.Csv;

  const estado = {
    db: null,
    info: null,
    aba: 'pesquisar',
    modulosSelecionados: new Set(),
    filtrosSelecionados: new Set(),
    colunas: [],
    gruposAbertos: new Set(),
    moduloAberto: false,
    relModulo: '*',
    relTexto: '',
    colTexto: '',
    filtroTexto: '',
    nomeBusca: '',
    menuOculto: true,
    cadastrosAberto: true,
    nuvemPapel: null, // 'admin' | 'editor' | null — só some quando faz login (Ctrl+Shift+B)
    nuvemStatus: { leituraAtiva: false, autenticado: false, email: null, papel: null, sincronizando: false, ultimoErro: null },
  };

  // Menus que só aparecem depois de liberados com Ctrl+Shift+B e a senha.
  const ABAS_PROTEGIDAS = new Set(['relatorios', 'colunas', 'filtros', 'dados']);

  // Relatórios, Colunas e Filtros ficam juntos, dentro do grupo recolhível "Cadastros"; Pesquisar
  // e Configurações continuam soltos no topo/fim da lista.
  const CADASTROS_ITENS = [
    ['relatorios', 'Relatórios'],
    ['colunas', 'Colunas'],
    ['filtros', 'Filtros'],
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

  // Igual a chamar(), mas não mostra aviso sozinho no erro — quem chamou decide como mostrar
  // (ex.: a tela de login mostra o erro dentro do próprio formulário, não como um toast solto).
  async function chamarSemAviso(nome, ...args) {
    try {
      return await window.api[nome](...args);
    } catch (erro) {
      return { ok: false, erro: erro && erro.message ? erro.message : String(erro) };
    }
  }

  function atualizarBanco(db) {
    estado.db = db;
    estado.modulosSelecionados = new Set([...estado.modulosSelecionados].filter((m) => db.modulos.includes(m)));
    if (estado.relModulo !== '*' && !db.modulos.includes(estado.relModulo)) estado.relModulo = '*';
  }

  // ---------- janelas (modais) ----------

  const pilhaModais = [];

  function abrirModal({ titulo, corpo, acoes = [], larga = false, aoFechar, obrigatorio = false }) {
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

    const controle = { fechar, caixa, obrigatorio };

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
      if (!topo.obrigatorio) topo.fechar(); // janela obrigatória só fecha pelo botão dela
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

  const ROTULO_IMAGEM = { relatorio: 'Imagem do relatório', filtro: 'Imagem do filtro' };

  async function verImagem(rel, tipo) {
    const r = await chamar('obterImagem', rel.id, tipo);
    if (!r) return;
    abrirModal({
      titulo: `${rel.nome} — ${ROTULO_IMAGEM[tipo].toLowerCase()}`,
      larga: true,
      corpo: r.dados
        ? h('img', {
            class: 'previa',
            src: r.dados,
            alt: `${ROTULO_IMAGEM[tipo]}: ${rel.nome}`,
            title: 'Clique pra abrir no tamanho original',
            onclick: () => chamar('abrirImagemNoSistema', rel.id, tipo),
          })
        : h('p', {}, 'O arquivo da imagem não foi encontrado. Anexe a imagem de novo em Relatórios.'),
      acoes: [{ rotulo: 'Fechar', tipo: 'primario' }],
    });
  }

  // Ícones (SVG desenhado na hora, sem depender de fonte ou emoji): documento = relatório, funil = filtro.
  function iconeSvg(tipo) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const caminhos = tipo === 'filtro' ? ['M2 3h12l-4.5 5.5V13l-3 1.5V8.5z'] : ['M4 2h5.5L13 5.5V14H4z', 'M9.5 2v3.5H13', 'M6 8.5h5M6 11h5'];
    for (const d of caminhos) {
      const c = document.createElementNS(NS, 'path');
      c.setAttribute('d', d);
      svg.append(c);
    }
    return svg;
  }

  // Sol (claro) e lua (escuro) pro interruptor de tema — desenhados na hora, sem depender de fonte/emoji.
  function iconeTemaSvg(tipo) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('aria-hidden', 'true');
    if (tipo === 'sol') {
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.4');
      svg.setAttribute('stroke-linecap', 'round');
      const centro = document.createElementNS(NS, 'circle');
      centro.setAttribute('cx', '8');
      centro.setAttribute('cy', '8');
      centro.setAttribute('r', '3');
      svg.append(centro);
      for (const [x1, y1, x2, y2] of [
        [8, 0.8, 8, 2.4],
        [8, 13.6, 8, 15.2],
        [0.8, 8, 2.4, 8],
        [13.6, 8, 15.2, 8],
        [2.7, 2.7, 3.8, 3.8],
        [12.2, 12.2, 13.3, 13.3],
        [2.7, 13.3, 3.8, 12.2],
        [12.2, 3.8, 13.3, 2.7],
      ]) {
        const raio = document.createElementNS(NS, 'line');
        raio.setAttribute('x1', x1);
        raio.setAttribute('y1', y1);
        raio.setAttribute('x2', x2);
        raio.setAttribute('y2', y2);
        svg.append(raio);
      }
    } else {
      svg.setAttribute('fill', 'currentColor');
      const lua = document.createElementNS(NS, 'path');
      lua.setAttribute('d', 'M13.8 10.2A6 6 0 1 1 5.8 2.2a6.6 6.6 0 1 0 8 8z');
      svg.append(lua);
    }
    return svg;
  }

  // Aplica de verdade a troca de cor da tela (só CSS reagindo ao atributo).
  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-tema', tema === 'escuro' ? 'escuro' : 'claro');
  }

  // Interruptor sol/lua — troca na hora (sem esperar o servidor) e salva por baixo, só neste computador.
  function criarInterruptorTema() {
    const botao = h('button', {
      type: 'button',
      class: 'tema-interruptor',
      'aria-pressed': String(estado.db.tema === 'escuro'),
      'aria-label': 'Alternar entre tema claro e escuro',
      onclick: async () => {
        const novo = estado.db.tema === 'escuro' ? 'claro' : 'escuro';
        estado.db.tema = novo; // otimista: muda a tela na hora
        aplicarTema(novo);
        botao.setAttribute('aria-pressed', String(novo === 'escuro'));
        const r = await chamarSemAviso('definirTema', novo);
        if (r.ok) atualizarBanco(r.dados);
      },
    }, iconeTemaSvg('sol'), h('span', { class: 'tema-trilho' }, h('span', { class: 'tema-bola' })), iconeTemaSvg('lua'));
    return botao;
  }

  // Botão-ícone redondo (igual ao "?") que abre uma das imagens do relatório.
  function botaoIconeImagem(rel, tipo) {
    const texto = `Ver ${ROTULO_IMAGEM[tipo].toLowerCase()}`;
    return h(
      'button',
      {
        type: 'button',
        class: `rel-icone rel-icone-${tipo}`,
        'aria-label': `${texto}: ${rel.nome}`,
        onclick: () => { dica.esconder(); verImagem(rel, tipo); },
        onmouseenter: (e) => dica.mostrar(e.currentTarget, texto),
        onmouseleave: () => dica.esconder(),
        onfocus: (e) => dica.mostrar(e.currentTarget, texto),
        onblur: () => dica.esconder(),
      },
      iconeSvg(tipo)
    );
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
    // sem isso, clicar na barra de rolagem tira o foco do campo de texto e o menu fecha na hora,
    // antes de dar tempo de arrastar pra baixo.
    const menu = h('ul', { class: 'picker-menu', id: idMenu, role: 'listbox', hidden: true, onmousedown: (e) => e.preventDefault() });
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

  // Editor dos filtros de um relatório (os campos que aparecem antes de rodar, tipo Cliente/
  // Emissão/Situação) — uma linha por filtro: nome, tipo, e opções só quando o tipo é lista.
  // Campo de buscar/criar filtro — mesmo padrão do campo de colunas: digita, aparecem sugestões
  // (os filtros já usados em outros relatórios), clica ou aperta Enter pra adicionar.
  // Editor de filtros do relatório — mesma caixa e o mesmo jeito de usar que o de colunas: chips
  // dentro de uma caixinha só, com o campo de busca/criar embutido no fim dela. Clicar num chip
  // abre uma janelinha pra ajustar o tipo e as opções (nome só muda pela busca/renomear).
  function criarEditorFiltros(iniciais) {
    let itens = (iniciais || []).map((f) => ({ nome: f.nome, tipo: f.tipo, opcoes: f.opcoes }));
    let sugeridos = [];
    let ativo = -1;
    let aberto = false;
    const idMenu = 'filtro-menu-' + Math.random().toString(36).slice(2, 8);

    const entrada = h('input', {
      type: 'text',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-controls': idMenu,
      'aria-expanded': 'false',
      'aria-label': 'Adicionar filtro',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const menu = h('ul', { class: 'picker-menu', id: idMenu, role: 'listbox', hidden: true, onmousedown: (e) => e.preventDefault() });
    const caixa = h('div', { class: 'picker-caixa', onclick: () => entrada.focus() }, entrada);
    const raiz = h('div', { class: 'picker' }, caixa, menu);

    function jaTem(nome) {
      return itens.some((it) => B.normalizarBusca(it.nome) === B.normalizarBusca(nome));
    }

    function abrirEdicao(i) {
      const it = itens[i];
      const campoTipo = h('select', {}, Object.entries(B.TIPOS_FILTRO).map(([valor, rotulo]) => h('option', { value: valor }, rotulo)));
      campoTipo.value = B.TIPOS_FILTRO[it.tipo] ? it.tipo : 'texto';
      const campoOpcoes = h('input', { type: 'text', placeholder: 'Ex.: Aberto, Fechado, Pendente', value: (it.opcoes || []).join(', ') });
      const blocoOpcoes = h('div', {}, h('label', { class: 'rotulo' }, 'Opções (separadas por vírgula)'), campoOpcoes);
      const ehLista = () => campoTipo.value === 'lista' || campoTipo.value === 'lista_multipla';
      const atualizarVisivel = () => { blocoOpcoes.hidden = !ehLista(); };
      campoTipo.addEventListener('change', atualizarVisivel);
      atualizarVisivel();
      abrirModal({
        titulo: `Filtro “${it.nome}”`,
        corpo: [h('div', {}, h('label', { class: 'rotulo' }, 'Tipo'), campoTipo), blocoOpcoes],
        acoes: [
          { rotulo: 'Cancelar' },
          {
            rotulo: 'Salvar',
            tipo: 'primario',
            aoClicar: () => {
              const novo = { nome: it.nome, tipo: campoTipo.value };
              if (ehLista()) novo.opcoes = campoOpcoes.value.split(',').map((o) => o.trim()).filter(Boolean);
              itens[i] = novo;
              desenharChips();
            },
          },
        ],
      });
    }

    function desenharChips() {
      caixa.querySelectorAll('.chip.editavel').forEach((e) => e.remove());
      itens.forEach((it, i) => {
        caixa.insertBefore(
          h(
            'span',
            { class: 'chip editavel', title: 'Clique pra ajustar o tipo/opções', onclick: () => abrirEdicao(i) },
            it.nome,
            h('button', {
              type: 'button',
              'aria-label': 'Remover filtro ' + it.nome,
              onclick: (e) => { e.stopPropagation(); itens.splice(i, 1); desenharChips(); },
            }, '×')
          ),
          entrada
        );
      });
      entrada.placeholder = itens.length ? 'Adicionar outro filtro' : 'Digite pra buscar um filtro já usado, ou criar um novo';
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
      if (!sugeridos.length) menu.append(h('li', { class: 'vazio' }, 'Nenhum filtro com esse nome'));
      sugeridos.forEach((it, i) => {
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
            it.novo
              ? `Criar filtro “${it.nome}”`
              : [h('span', {}, it.nome), h('small', {}, `${B.TIPOS_FILTRO[it.tipo] || 'Texto'} · ${plural(it.qtd, 'relatório', 'relatórios')}`)]
          )
        );
      });
      menu.hidden = false;
      entrada.setAttribute('aria-expanded', 'true');
    }

    function atualizarMenu() {
      const texto = entrada.value.trim();
      const busca = B.normalizarBusca(texto);
      const catalogo = filtrosComCadastrados(estado.db.relatorios);
      sugeridos = (busca ? catalogo.filter((f) => B.normalizarBusca(f.nome).includes(busca)) : catalogo.slice()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
      const nomeLimpo = texto.replace(/\s+/g, ' ').trim();
      const existeExato = catalogo.some((f) => B.normalizarBusca(f.nome) === busca);
      if (nomeLimpo && !existeExato && !jaTem(nomeLimpo)) sugeridos.push({ nome: nomeLimpo, novo: true });
      sugeridos = sugeridos.filter((it) => it.novo || !jaTem(it.nome)); // já adicionados não aparecem de novo na lista
      ativo = sugeridos.length ? 0 : -1;
      desenharMenu();
      marcarAtivo(false);
    }

    function abrir() { aberto = true; atualizarMenu(); }
    function fecharMenu() { aberto = false; desenharMenu(); }

    function escolher(i) {
      const it = sugeridos[i];
      if (!it) return;
      if (jaTem(it.nome)) { aviso(`“${it.nome}” já está na lista.`); return; }
      itens.push(it.novo ? { nome: it.nome, tipo: 'texto' } : { nome: it.nome, tipo: it.tipo, opcoes: it.opcoes });
      entrada.value = '';
      desenharChips();
      if (aberto) atualizarMenu();
    }

    entrada.addEventListener('input', abrir);
    entrada.addEventListener('focus', abrir);
    entrada.addEventListener('blur', fecharMenu);
    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!aberto) return abrir();
        if (!sugeridos.length) return;
        ativo = (ativo + (e.key === 'ArrowDown' ? 1 : -1) + sugeridos.length) % sugeridos.length;
        marcarAtivo(true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (aberto && ativo >= 0) escolher(ativo);
      } else if (e.key === 'Escape') {
        if (aberto) {
          e.stopPropagation();
          fecharMenu();
        }
      } else if (e.key === 'Backspace' && !entrada.value && itens.length) {
        itens.pop();
        desenharChips();
      }
    });

    desenharChips();
    return {
      el: raiz,
      valores: () => itens.map((it) => ({ ...it })),
    };
  }

  // ---------- abas ----------

  function montarAbas() {
    const nav = $('#abas');
    const botaoAba = (id, nome, extraClasse) =>
      h('button', { type: 'button', class: extraClasse || '', 'data-aba': id, onclick: () => { estado.aba = id; render(); } }, nome);

    const nos = [botaoAba('pesquisar', 'Pesquisar')];
    if (!estado.menuOculto) {
      nos.push(
        h(
          'button',
          {
            type: 'button',
            class: 'submenu-cabecalho',
            'aria-expanded': String(estado.cadastrosAberto),
            onclick: () => {
              estado.cadastrosAberto = !estado.cadastrosAberto;
              montarAbas();
              render();
            },
          },
          h('span', {}, 'Cadastros'),
          h('span', { class: 'grupo-seta', 'aria-hidden': 'true' }, '▾')
        )
      );
      if (estado.cadastrosAberto) for (const [id, nome] of CADASTROS_ITENS) nos.push(botaoAba(id, nome, 'submenu-item'));
      nos.push(botaoAba('dados', 'Configurações'));
    }
    nav.replaceChildren(...nos);
  }

  // Pede e-mail e senha (a mesma conta cadastrada na nuvem) para mostrar Relatórios, Colunas,
  // Filtros e Configurações. Só entrar já eleva a permissão de escrever; não precisa reconectar nada.
  function pedirLogin() {
    return new Promise((resolver) => {
      const campoEmail = h('input', { type: 'email', id: 'campo-email', autocomplete: 'off' });
      const campoSenha = h('input', { type: 'password', id: 'campo-senha', autocomplete: 'off' });
      const erroEl = h('p', { class: 'ajuda erro-login', hidden: true });
      const enviar = async () => {
        erroEl.hidden = true;
        botaoEntrar.disabled = true;
        try {
          const r = await chamarSemAviso('nuvemEntrar', campoEmail.value, campoSenha.value);
          if (!r.ok) {
            erroEl.textContent = r.erro;
            erroEl.hidden = false;
            botaoEntrar.disabled = false;
            return;
          }
          resolver(r.dados);
          modal.fechar(false);
        } catch (_) {
          erroEl.textContent = 'Não consegui falar com o servidor. Confira sua internet.';
          erroEl.hidden = false;
          botaoEntrar.disabled = false;
        }
      };
      [campoEmail, campoSenha].forEach((c) =>
        c.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            enviar();
          }
        })
      );
      const modal = abrirModal({
        titulo: 'Entrar',
        corpo: [
          h('div', {}, h('label', { class: 'rotulo', for: 'campo-email' }, 'E-mail'), campoEmail),
          h('div', {}, h('label', { class: 'rotulo', for: 'campo-senha' }, 'Senha'), campoSenha),
          erroEl,
          h('p', { class: 'ajuda' }, 'Entre com sua conta para mostrar Relatórios, Colunas, Filtros e Configurações.'),
        ],
        aoFechar: () => resolver(null),
        acoes: [
          { rotulo: 'Cancelar', aoClicar: () => resolver(null) },
          { rotulo: 'Entrar', tipo: 'primario', chamarAoFechar: false, aoClicar: () => { enviar(); return false; } },
        ],
      });
      const botaoEntrar = modal.caixa.querySelector('.modal-acoes .btn.primario');
    });
  }

  // Ctrl+Shift+B: libera os menus (pede login) ou esconde de novo (e encerra a sessão de escrita).
  async function alternarMenu() {
    if (pilhaModais.length) return;
    if (estado.menuOculto) {
      const sessao = await pedirLogin();
      if (!sessao) return;
      estado.menuOculto = false;
      estado.nuvemPapel = sessao.papel;
      aviso('Menus liberados');
    } else {
      await chamarSemAviso('nuvemSair');
      estado.menuOculto = true;
      estado.nuvemPapel = null;
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
    else if (estado.aba === 'filtros') renderFiltros(alvo);
    else renderDados(alvo);
  }

  // Primeira vez que o programa abre neste computador: todos os módulos começam desmarcados e a
  // pessoa marca os que usa. A escolha fica salva aqui e sobrevive às atualizações do programa.
  function abrirEscolhaModulosIniciais() {
    const caixas = new Map();
    const lista = h(
      'div',
      { class: 'lista-checkbox' },
      estado.db.modulos.map((m) => {
        const id = 'escolha-modulo-' + m;
        const input = h('input', { type: 'checkbox', id, onchange: atualizarBotao });
        caixas.set(m, input);
        return h('label', { class: 'checkbox-linha', for: id }, input, h('span', {}, m));
      })
    );
    const marcados = () => [...caixas.entries()].filter(([, c]) => c.checked).map(([m]) => m);

    const controle = abrirModal({
      titulo: 'Escolha os módulos que você usa',
      obrigatorio: true,
      corpo: [
        h('p', {}, 'Marque só os módulos do Ativo.ERP que você usa. A pesquisa vai mostrar apenas esses. Você pode mudar isso depois em Configurações.'),
        h(
          'div',
          { class: 'barra' },
          h('button', { type: 'button', class: 'btn pequeno discreto', onclick: () => { caixas.forEach((c) => { c.checked = true; }); atualizarBotao(); } }, 'Marcar todos'),
          h('button', { type: 'button', class: 'btn pequeno discreto', onclick: () => { caixas.forEach((c) => { c.checked = false; }); atualizarBotao(); } }, 'Desmarcar todos')
        ),
        lista,
      ],
      acoes: [
        {
          rotulo: 'Continuar',
          tipo: 'primario',
          desabilitado: true,
          aoClicar: async () => {
            const escolhidos = new Set(marcados());
            const ocultos = estado.db.modulos.filter((m) => !escolhidos.has(m));
            const r = await chamar('definirModulosOcultos', ocultos);
            if (!r) return false;
            atualizarBanco(r.dados);
            render();
          },
        },
      ],
    });
    const botao = controle.caixa.querySelector('.modal-acoes .btn');
    function atualizarBotao() {
      botao.disabled = marcados().length === 0;
    }
    return controle;
  }

  // ---------- aba Pesquisar ----------

  let ui = {};

  // Módulos e relatórios que entram na pesquisa: tira os que a pessoa escondeu em Configurações
  // (preferência só deste computador — não mexe nas abas Relatórios/Colunas, só na Pesquisar).
  function modulosNaPesquisa() {
    const ocultos = new Set(estado.db.modulosOcultos || []);
    return estado.db.modulos.filter((m) => !ocultos.has(m));
  }
  function relatoriosNaPesquisa() {
    const ocultos = estado.db.modulosOcultos || [];
    let lista = ocultos.length ? estado.db.relatorios.filter((r) => !new Set(ocultos).has(r.modulo)) : estado.db.relatorios;
    if (estado.modulosSelecionados.size) {
      lista = lista.filter((r) => estado.modulosSelecionados.has(r.modulo));
    }
    const nomeBusca = B.normalizarBusca(estado.nomeBusca || '');
    if (nomeBusca) lista = lista.filter((r) => B.normalizarBusca(r.nome).includes(nomeBusca));
    if (estado.filtrosSelecionados.size) {
      const nomesBuscados = [...estado.filtrosSelecionados].map((n) => B.normalizarBusca(n));
      lista = lista.filter((r) => {
        const nomesDoRel = new Set((r.filtros || []).map((f) => B.normalizarBusca(f.nome)));
        return nomesBuscados.every((n) => nomesDoRel.has(n));
      });
    }
    return lista;
  }

  // As sugestões de coluna/filtro somam o que já é usado em algum relatório com o que foi
  // cadastrado "solto" (pela tela de Colunas/Filtros) mas ainda não está em nenhum relatório.
  function colunasComCadastradas(relatorios) {
    const base = B.colunasDoEscopo(relatorios, '*');
    const existentes = new Set(base.map((c) => c.nome));
    const extras = (estado.db.colunasCadastradas || []).filter((n) => !existentes.has(n)).map((nome) => ({ nome, qtd: 0 }));
    return [...base, ...extras];
  }
  function filtrosComCadastrados(relatorios) {
    const base = B.catalogoFiltros(relatorios);
    const existentes = new Set(base.map((f) => B.normalizarBusca(f.nome)));
    const extras = (estado.db.filtrosCadastrados || []).filter((f) => !existentes.has(B.normalizarBusca(f.nome))).map((f) => ({ ...f, qtd: 0, relatorios: [] }));
    return [...base, ...extras];
  }
  // Igual a colunasComCadastradas, mas na forma que a tabela da aba Colunas usa (com "modulos").
  function colunasComCadastradasTabela(relatorios) {
    const base = B.estatisticasColunas(relatorios);
    const existentes = new Set(base.map((c) => c.nome));
    const extras = (estado.db.colunasCadastradas || []).filter((n) => !existentes.has(n)).map((nome) => ({ nome, qtd: 0, modulos: [] }));
    return [...base, ...extras].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  }

  function renderPesquisa(alvo) {
    ui = {};
    ui.segmentos = h('div', { class: 'segmentos', role: 'group', 'aria-label': 'Módulos' });
    ui.segmentos.hidden = !estado.moduloAberto;
    ui.rotuloModulo = h('span', { class: 'rotulo' }, '');
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
      ui.rotuloModulo,
      h('span', { class: 'grupo-seta', 'aria-hidden': 'true' }, '▾')
    );
    ui.picker = criarPicker({
      opcoes: () => colunasComCadastradas(relatoriosNaPesquisa()),
      valores: estado.colunas,
      placeholder: 'Digite parte do nome da coluna',
      rotulo: 'Colunas que o relatório precisa ter',
      aoMudar: (v) => {
        estado.colunas = v;
        estado.gruposAbertos.clear();
        atualizarPesquisa();
      },
    });
    ui.pickerFiltros = criarPicker({
      opcoes: () => filtrosComCadastrados(relatoriosNaPesquisa()).map((f) => ({ nome: f.nome, qtd: f.qtd })),
      valores: [...estado.filtrosSelecionados],
      placeholder: 'Digite parte do nome do filtro',
      rotulo: 'Filtros que o relatório precisa ter',
      aoMudar: (v) => {
        estado.filtrosSelecionados = new Set(v);
        estado.gruposAbertos.clear();
        atualizarPesquisa();
      },
    });
    ui.limpar = h('button', { type: 'button', class: 'btn', onclick: () => { ui.picker.definir([]); estado.colunas = []; estado.gruposAbertos.clear(); atualizarPesquisa(); ui.picker.focar(); } }, 'Limpar colunas');
    ui.exportar = h('button', { type: 'button', class: 'btn', onclick: exportarResultado }, 'Exportar para Excel (CSV)');
    ui.resultados = h('div', { class: 'resultados', tabindex: '-1' });
    ui.buscaNome = h('input', {
      type: 'search',
      id: 'busca-nome-relatorio',
      placeholder: 'Ex.: cheques, vendas por vendedor',
      autocomplete: 'off',
      value: estado.nomeBusca,
      oninput: (e) => { estado.nomeBusca = e.target.value; estado.gruposAbertos.clear(); atualizarPesquisa(); },
    });

    const filtros = h(
      'aside',
      { class: 'filtros', 'aria-label': 'Filtros' },
      h('section', {}, h('div', { class: 'modulo-caixa' }, ui.moduloCabecalho, ui.segmentos)),
      h(
        'section',
        {},
        h('label', { class: 'rotulo', for: 'busca-nome-relatorio' }, 'Buscar pelo nome do relatório'),
        ui.buscaNome,
        h('p', { class: 'ajuda' }, 'Opcional. Sozinho, lista os relatórios com esse nome; junto com colunas, refina o resultado.')
      ),
      h(
        'section',
        {},
        h('span', { class: 'rotulo' }, 'Colunas que o relatório precisa ter'),
        ui.picker.el,
        h('p', { class: 'ajuda' }, 'Escolha uma ou mais. Os relatórios aparecem agrupados por quantas dessas colunas eles têm.')
      ),
      h(
        'section',
        {},
        h('span', { class: 'rotulo' }, 'Filtros que o relatório precisa ter'),
        ui.pickerFiltros.el,
        h('p', { class: 'ajuda' }, 'Escolha um ou mais filtros (da lista cadastrada em Filtros). Mostra só quem tem todos os escolhidos.')
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

  // Rótulo da caixa fechada: "Todos", o nome do único escolhido, ou "N módulos".
  function rotuloModuloAtual() {
    const n = estado.modulosSelecionados.size;
    if (!n) return 'Todos';
    if (n === 1) return [...estado.modulosSelecionados][0];
    return `${n} módulos`;
  }

  function desenharSegmentos() {
    const ocultos = new Set(estado.db.modulosOcultos || []);
    const semOcultos = ocultos.size ? estado.db.relatorios.filter((r) => !ocultos.has(r.modulo)) : estado.db.relatorios;
    const contar = (m) => semOcultos.filter((r) => r.modulo === m).length;
    ui.rotuloModulo.textContent = rotuloModuloAtual();
    ui.segmentos.replaceChildren(
      h(
        'div',
        { class: 'segmentos-acoes' },
        h('button', { type: 'button', class: 'btn discreto pequeno', onclick: () => { estado.modulosSelecionados.clear(); estado.gruposAbertos.clear(); atualizarPesquisa(); } }, 'Todos'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn discreto pequeno',
            onclick: () => { estado.modulosSelecionados = new Set(modulosNaPesquisa()); estado.gruposAbertos.clear(); atualizarPesquisa(); },
          },
          'Marcar todos'
        )
      ),
      ...modulosNaPesquisa().map((m) => {
        const id = 'seg-modulo-' + m;
        return h(
          'label',
          { class: 'checkbox-linha segmento-linha', for: id },
          h('input', {
            type: 'checkbox',
            id,
            checked: estado.modulosSelecionados.has(m),
            onchange: (e) => {
              if (e.target.checked) estado.modulosSelecionados.add(m);
              else estado.modulosSelecionados.delete(m);
              estado.gruposAbertos.clear();
              atualizarPesquisa();
            },
          }),
          h('span', {}, m),
          h('small', {}, contar(m))
        );
      })
    );
  }

  let ultimoResultado = null;

  function atualizarPesquisa() {
    desenharSegmentos();
    const resultado = B.pesquisar(relatoriosNaPesquisa(), { modulo: '*', colunas: estado.colunas });
    ultimoResultado = resultado;

    ui.limpar.disabled = !estado.colunas.length;
    ui.exportar.disabled = !resultado.total;

    desenharResultados(resultado);
  }

  function nomeEscopo() {
    const n = estado.modulosSelecionados.size;
    if (!n) return 'todos os módulos';
    if (n === 1) return [...estado.modulosSelecionados][0];
    return `${n} módulos escolhidos`;
  }

  function vazioPesquisa() {
    const comuns = B.colunasDoEscopo(relatoriosNaPesquisa(), '*').slice(0, 18);
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
        h('span', { class: 'rel-modulo' }, rel.modulo)
      ),
      rel.colunas.length ? chipsDeColunas(rel, escolhidas) : h('p', { class: 'rel-sem-colunas' }, 'Sem colunas cadastradas.'),
      rel.funcionalidade || rel.imagem || rel.imagemFiltro
        ? h(
            'div',
            { class: 'rel-rodape' },
            rel.imagem ? botaoIconeImagem(rel, 'relatorio') : null,
            rel.imagemFiltro ? botaoIconeImagem(rel, 'filtro') : null,
            rel.funcionalidade
              ? h(
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
              : null
          )
        : null
    );
  }

  // Busca só pelo nome (sem colunas escolhidas): lista simples dos relatórios que batem,
  // já respeitando os módulos marcados e os escondidos em Configurações.
  function desenharResultadosPorNome(alvo) {
    const lista = relatoriosNaPesquisa().slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    const nome = estado.nomeBusca.trim();
    const filtros = [...estado.filtrosSelecionados];
    const partes = [];
    if (nome) partes.push(`o nome contém “${nome}”`);
    if (filtros.length) partes.push(`${filtros.length > 1 ? 'tem os filtros' : 'tem o filtro'} ${filtros.map((f) => `“${f}”`).join(', ')}`);
    const legenda = partes.length
      ? `${partes[0].charAt(0).toUpperCase()}${partes[0].slice(1)}${partes[1] ? ' e ' + partes[1] : ''}. Pesquisando em ${nomeEscopo()}.`
      : `Pesquisando em ${nomeEscopo()}.`;
    alvo.append(
      h(
        'div',
        { class: 'resultados-topo' },
        h(
          'div',
          {},
          h('h1', {}, lista.length ? plural(lista.length, 'relatório encontrado', 'relatórios encontrados') : 'Nenhum relatório encontrado'),
          h('p', { class: 'ajuda' }, legenda)
        )
      ),
      ...lista.map((rel) => linhaRelatorio({ rel }, new Set()))
    );
  }

  function desenharResultados(resultado) {
    const alvo = ui.resultados;
    alvo.replaceChildren();
    const n = estado.colunas.length;
    if (!n) {
      if (B.normalizarBusca(estado.nomeBusca || '') || estado.filtrosSelecionados.size) desenharResultadosPorNome(alvo);
      else alvo.append(vazioPesquisa());
      return;
    }

    const melhor = resultado.grupos[0];
    let titulo;
    let subtitulo = null;
    if (!resultado.total) {
      titulo = 'Nenhum relatório tem essas colunas';
      subtitulo = `Tire alguma coluna${estado.modulosSelecionados.size === 0 ? '' : ' ou pesquise em Todos os módulos'} para ampliar a busca.`;
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
          h('thead', {}, h('tr', {}, h('th', {}, 'Relatório'), h('th', {}, 'Módulo'), h('th', { class: 'num' }, 'Colunas'), h('th', {}, 'Imagens'))),
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
                h('td', {}, r.imagem ? h('span', { class: 'tag auto' }, 'Relatório') : '', ' ', r.imagemFiltro ? h('span', { class: 'tag auto' }, 'Filtro') : '')
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
      opcoes: () => colunasComCadastradas(estado.db.relatorios),
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

    const editorFiltros = criarEditorFiltros(rel ? rel.filtros : []);

    // As duas imagens (do relatório e do filtro) — só depois que o relatório existe.
    function criarBlocoImagem(tipo) {
      const campo = tipo === 'filtro' ? 'imagemFiltro' : 'imagem';
      const area = h('div', { class: 'imagem-campo' });
      const desenharImagem = async () => {
        const atual = estado.db.relatorios.find((r) => r.id === rel.id);
        area.replaceChildren();
        if (atual && atual[campo]) {
          const r = await chamar('obterImagem', rel.id, tipo);
          if (r && r.dados) area.append(h('img', { class: 'previa', src: r.dados, alt: `${ROTULO_IMAGEM[tipo]} anexada`, title: 'Clique pra abrir no tamanho original', onclick: () => chamar('abrirImagemNoSistema', rel.id, tipo) }));
          else area.append(h('p', { class: 'ajuda' }, 'A imagem anexada não foi encontrada no disco. Anexe de novo.'));
        } else if (tipo === 'filtro' && atual && atual.imagemOriginal) {
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
                const r = await chamar('anexarImagem', rel.id, tipo);
                if (r && r.dados) { atualizarBanco(r.dados); aviso('Imagem anexada'); desenharImagem(); }
              },
            }, atual && atual[campo] ? 'Trocar imagem' : 'Anexar imagem'),
            atual && atual[campo]
              ? h('button', {
                  type: 'button',
                  class: 'btn pequeno perigo',
                  onclick: async () => {
                    const r = await chamar('removerImagem', rel.id, tipo);
                    if (r) { atualizarBanco(r.dados); aviso('Imagem removida'); desenharImagem(); }
                  },
                }, 'Remover imagem')
              : null
          )
        );
      };
      desenharImagem();
      return h('div', { class: `bloco-imagem bloco-imagem-${tipo}` }, h('span', { class: 'rotulo' }, ROTULO_IMAGEM[tipo]), area);
    }

    let blocoImagem = null;
    if (!novo) {
      blocoImagem = h(
        'div',
        {},
        criarBlocoImagem('relatorio'),
        criarBlocoImagem('filtro'),
        h('p', { class: 'ajuda' }, 'As imagens são salvas assim que você escolhe o arquivo. Nos resultados da pesquisa aparecem dois ícones, um para cada imagem.')
      );
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
        h(
          'div',
          {},
          h('span', { class: 'rotulo' }, 'Filtros do relatório (opcional)'),
          h('p', { class: 'ajuda' }, 'Os campos que aparecem na telinha do sistema antes de rodar o relatório (ex.: Cliente, Emissão, Situação) — não confundir com as colunas do resultado, acima.'),
          editorFiltros.el
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
              filtros: editorFiltros.valores(),
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

  async function criarColunaPrompt() {
    const nome = await pedirTexto({ titulo: 'Nova coluna', rotulo: 'Nome da coluna', ajuda: 'Fica disponível como sugestão em qualquer relatório, mesmo antes de usar em algum.' });
    if (!nome) return;
    const r = await chamar('criarColuna', nome);
    if (!r) return;
    atualizarBanco(r.dados);
    aviso('Coluna criada');
    render();
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

    const todas = colunasComCadastradasTabela(estado.db.relatorios);

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
                  h('button', { type: 'button', class: 'btn pequeno discreto', onclick: () => { estado.aba = 'pesquisar'; estado.modulosSelecionados.clear(); estado.colunas = [c.nome]; estado.gruposAbertos.clear(); render(); } }, 'Ver relatórios'),
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
          h('p', { class: 'ajuda' }, 'Renomear uma coluna vale para todos os relatórios que a usam. "Nova coluna" cadastra uma solta, pra já aparecer como sugestão antes de usar em algum relatório.'),
          painelSimilares,
          h('div', { class: 'barra' }, busca, h('button', { type: 'button', class: 'btn', onclick: () => criarColunaPrompt() }, 'Nova coluna'), contagem),
          tabela
        )
      )
    );
    desenharTabela();
  }

  // ---------- aba Filtros ----------

  // Cria um filtro "solto" (nome + tipo + opções se for lista), pra já aparecer nas sugestões
  // do editor de relatório antes de estar em algum. Não deixa criar um que já existe.
  function criarFiltroPrompt() {
    const campoNome = h('input', { type: 'text', id: 'novo-filtro-nome', placeholder: 'Ex.: Cliente', autocomplete: 'off' });
    const campoTipo = h('select', { id: 'novo-filtro-tipo' }, Object.entries(B.TIPOS_FILTRO).map(([valor, rotulo]) => h('option', { value: valor }, rotulo)));
    const campoOpcoes = h('input', { type: 'text', id: 'novo-filtro-opcoes', placeholder: 'Ex.: Aberto, Fechado, Pendente', autocomplete: 'off' });
    const blocoOpcoes = h('div', {}, h('label', { class: 'rotulo', for: 'novo-filtro-opcoes' }, 'Opções (separadas por vírgula)'), campoOpcoes);
    const atualizarOpcoes = () => { blocoOpcoes.hidden = !(campoTipo.value === 'lista' || campoTipo.value === 'lista_multipla'); };
    campoTipo.addEventListener('change', atualizarOpcoes);
    atualizarOpcoes();

    abrirModal({
      titulo: 'Novo filtro',
      corpo: [
        h('div', {}, h('label', { class: 'rotulo', for: 'novo-filtro-nome' }, 'Nome do filtro'), campoNome),
        h('div', {}, h('label', { class: 'rotulo', for: 'novo-filtro-tipo' }, 'Tipo'), campoTipo),
        blocoOpcoes,
      ],
      acoes: [
        { rotulo: 'Cancelar' },
        {
          rotulo: 'Criar',
          tipo: 'primario',
          aoClicar: async () => {
            const lista = campoTipo.value === 'lista' || campoTipo.value === 'lista_multipla';
            const r = await chamar('criarFiltro', {
              nome: campoNome.value,
              tipo: campoTipo.value,
              opcoes: lista ? campoOpcoes.value.split(',').map((o) => o.trim()).filter(Boolean) : undefined,
            });
            if (!r) return false; // erro (ex.: já existe) já apareceu na tela; janela continua aberta pra corrigir
            atualizarBanco(r.dados);
            aviso('Filtro criado');
            render();
          },
        },
      ],
    });
  }

  async function renomearFiltroPrompt(item) {
    const digitado = await pedirTexto({
      titulo: 'Renomear filtro',
      rotulo: 'Novo nome',
      valor: item.nome,
      ajuda: 'A mudança vale em todos os relatórios que têm esse filtro. O tipo e as opções de cada um continuam os mesmos.',
    });
    if (digitado === null) return;
    const novo = digitado.replace(/\s+/g, ' ').trim();
    if (!novo || novo === item.nome) return;
    if (item.qtd > 0) {
      const ok = await confirmar({
        titulo: 'Cuidado ao renomear',
        mensagem: `Esse filtro está em ${plural(item.qtd, 'relatório', 'relatórios')}. Renomear vale pra todos eles de uma vez — não dá pra desfazer sozinho. Quer continuar?`,
        rotulo: 'Renomear mesmo assim',
        perigo: true,
      });
      if (!ok) return;
    }
    const r = await chamar('renomearFiltro', item.nome, novo);
    if (!r) return;
    atualizarBanco(r.dados.db);
    aviso(r.dados.alterados ? plural(r.dados.alterados, 'relatório atualizado', 'relatórios atualizados') : 'Filtro renomeado.');
    render();
  }

  function abrirRelatoriosDoFiltro(item) {
    abrirModal({
      titulo: `Relatórios com o filtro “${item.nome}”`,
      corpo: [
        h(
          'ul',
          { class: 'lista-simples' },
          item.relatorios.map((r) => h('li', {}, `${r.nome} `, h('span', { class: 'rel-modulo' }, r.modulo)))
        ),
      ],
      acoes: [{ rotulo: 'Fechar', tipo: 'primario' }],
    });
  }

  function renderFiltros(alvo) {
    const tabela = h('div', {});
    const contagem = h('span', { class: 'contagem' });

    const busca = h('input', {
      type: 'search',
      class: 'crescer',
      placeholder: 'Buscar filtro',
      'aria-label': 'Buscar filtro',
      value: estado.filtroTexto,
      oninput: (e) => { estado.filtroTexto = e.target.value; desenharTabela(); },
    });

    const todos = filtrosComCadastrados(estado.db.relatorios);

    function desenharTabela() {
      const texto = B.normalizarBusca(estado.filtroTexto);
      const lista = todos.filter((f) => !texto || B.normalizarBusca(f.nome).includes(texto));
      contagem.textContent = plural(lista.length, 'filtro', 'filtros');
      if (!lista.length) {
        tabela.replaceChildren(
          h('div', { class: 'tabela-vazia' }, texto ? 'Nenhum filtro com esse nome.' : 'Nenhum filtro cadastrado ainda. Use “Novo filtro” ou adicione pelo editor de um relatório.')
        );
        return;
      }
      tabela.replaceChildren(
        h(
          'table',
          { class: 'tabela' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Filtro'), h('th', {}, 'Tipo'), h('th', { class: 'num' }, 'Relatórios'), h('th', {}, ''))),
          h(
            'tbody',
            {},
            lista.map((f) =>
              h(
                'tr',
                {},
                h('td', { class: 'mono' }, f.nome),
                h('td', { class: 'ajuda' }, B.TIPOS_FILTRO[f.tipo] || 'Texto'),
                h('td', { class: 'num' }, f.qtd),
                h(
                  'td',
                  { class: 'acoes' },
                  h('button', { type: 'button', class: 'btn pequeno discreto', onclick: () => abrirRelatoriosDoFiltro(f) }, 'Ver relatórios'),
                  h('button', { type: 'button', class: 'btn pequeno discreto', onclick: () => renomearFiltroPrompt(f) }, 'Renomear')
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
          h('h1', {}, 'Filtros'),
          h('p', { class: 'ajuda' }, 'Os campos que aparecem na telinha do sistema antes de rodar um relatório (Cliente, Emissão, Situação...). Renomear um filtro vale para todos os relatórios que o têm.'),
          h('div', { class: 'barra' }, busca, h('button', { type: 'button', class: 'btn', onclick: () => criarFiltroPrompt() }, 'Novo filtro'), contagem),
          tabela
        )
      )
    );
    desenharTabela();
  }

  // ---------- aba Configurações (dados, backup, atualização e módulos da pesquisa) ----------

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
          h('li', {}, h('b', {}, 'COLUNAS'), ' — todas as colunas do relatório numa célula só, separadas por ponto e vírgula ( ; ).'),
          h('li', {}, h('b', {}, 'FILTROS'), ' — os campos que aparecem na telinha do sistema antes de rodar o relatório (Cliente, Emissão, Situação...). Pode deixar em branco.')
        ),
        h('p', {}, 'Uma linha por relatório. Se já existir um relatório com o mesmo nome nesse módulo, as colunas são substituídas pelas da planilha; a funcionalidade só muda se vier preenchida. Nos filtros, só os que aparecerem na célula FILTROS são criados ou atualizados — os que o relatório já tinha e não foram mencionados continuam do jeito que estavam.'),
        h('p', { class: 'rotulo' }, 'Exemplo:'),
        h(
          'pre',
          { class: 'exemplo-csv' },
          'MODULO;NOME;FUNCIONALIDADE;COLUNAS;FILTROS\nATIVO_LOG;Vendas por Vendedor;Mostra o total vendido por vendedor.;"VENDEDOR;VALOR;DATA;CLIENTE";"Vendedor:texto;Periodo:periodo"'
        ),
        h(
          'p',
          { class: 'ajuda' },
          'Cada filtro na célula FILTROS é Nome:tipo (ou Nome:tipo:opção1,opção2 para listas), separados por ponto e vírgula. Tipos aceitos: texto, numero, data, periodo, lista, lista_multipla. Exemplo com lista: "Situacao:lista:Aberto,Compensado,Devolvido".'
        ),
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
            const payload = validas.map((l) => ({ modulo: l.modulo, nome: l.nome, funcionalidade: l.funcionalidade, colunas: l.colunas, filtros: l.filtros }));
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

  // Resumo do status da nuvem (usado dentro de Configurações).
  function desenharStatusNuvem() {
    const s = estado.nuvemStatus;
    if (!s.leituraAtiva && !s.ultimoErro) return h('p', { class: 'ajuda' }, 'Este programa não tem a nuvem configurada — funcionando só com os dados deste computador.');
    const partes = [];
    partes.push(s.leituraAtiva ? h('span', { class: 'tag auto' }, 'Sincronizado') : h('span', { class: 'tag perigo' }, 'Sem conexão'));
    if (s.sincronizando) partes.push(h('span', { class: 'tag' }, 'Enviando…'));
    if (s.autenticado) partes.push(h('span', {}, `Logado como ${s.email} (${s.papel === 'admin' ? 'administrador' : 'editor'})`));
    const linha = h('div', { class: 'barra' }, ...partes);
    return s.ultimoErro ? h('div', {}, linha, h('p', { class: 'ajuda erro-login' }, s.ultimoErro)) : linha;
  }

  function abrirAlterarMinhaSenha() {
    const campo1 = h('input', { type: 'password', id: 'nova-minha-senha', autocomplete: 'new-password' });
    const campo2 = h('input', { type: 'password', id: 'confirma-minha-senha', autocomplete: 'new-password' });
    abrirModal({
      titulo: 'Alterar minha senha',
      corpo: [
        h('div', {}, h('label', { class: 'rotulo', for: 'nova-minha-senha' }, 'Nova senha (mínimo 6 caracteres)'), campo1),
        h('div', {}, h('label', { class: 'rotulo', for: 'confirma-minha-senha' }, 'Confirme a nova senha'), campo2),
      ],
      acoes: [
        { rotulo: 'Cancelar' },
        {
          rotulo: 'Salvar',
          tipo: 'primario',
          aoClicar: async () => {
            if (campo1.value.length < 6) { aviso('A senha precisa ter pelo menos 6 caracteres.', 'erro'); return false; }
            if (campo1.value !== campo2.value) { aviso('As senhas digitadas são diferentes.', 'erro'); return false; }
            const r = await chamar('nuvemRedefinirMinhaSenha', campo1.value);
            if (!r) return false;
            aviso('Senha alterada.');
          },
        },
      ],
    });
  }

  // ---------- painel de usuários (só quando estado.nuvemPapel === 'admin') ----------

  function renderPainelUsuarios() {
    const corpo = h('div', {}, h('p', { class: 'ajuda' }, 'Carregando…'));
    const painel = h('section', { class: 'painel' }, h('h2', {}, 'Usuários'), h('p', { class: 'ajuda' }, 'Quem pode entrar (Ctrl+Shift+B) e editar. "Administrador" também gerencia outros usuários.'), corpo);

    async function carregar() {
      const r = await chamar('nuvemListarUsuarios');
      if (!r) return;
      desenhar(r.dados);
    }

    function desenhar(usuarios) {
      corpo.replaceChildren(
        h(
          'table',
          { class: 'tabela' },
          h('thead', {}, h('tr', {}, h('th', {}, 'E-mail'), h('th', {}, 'Papel'), h('th', {}, ''))),
          h(
            'tbody',
            {},
            usuarios.map((u) =>
              h(
                'tr',
                {},
                h('td', {}, u.email),
                h('td', {}, u.papel === 'admin' ? 'Administrador' : 'Editor'),
                h(
                  'td',
                  { class: 'acoes' },
                  h('button', {
                    type: 'button',
                    class: 'btn pequeno discreto',
                    onclick: async () => {
                      const novoPapel = u.papel === 'admin' ? 'editor' : 'admin';
                      const ok = await confirmar({ titulo: 'Trocar papel', mensagem: `Tornar ${u.email} ${novoPapel === 'admin' ? 'administrador' : 'editor'}?`, rotulo: 'Trocar' });
                      if (!ok) return;
                      const r = await chamar('nuvemDefinirPapel', u.email, novoPapel);
                      if (r) { aviso('Papel alterado.'); carregar(); }
                    },
                  }, u.papel === 'admin' ? 'Tornar editor' : 'Tornar admin'),
                  h('button', {
                    type: 'button',
                    class: 'btn pequeno discreto',
                    onclick: () => abrirRedefinirSenhaUsuario(u.email),
                  }, 'Redefinir senha'),
                  h('button', {
                    type: 'button',
                    class: 'btn pequeno discreto perigo',
                    onclick: async () => {
                      const ok = await confirmar({ titulo: 'Excluir usuário', mensagem: `Excluir o acesso de ${u.email}?`, rotulo: 'Excluir', perigo: true });
                      if (!ok) return;
                      const r = await chamar('nuvemExcluirUsuario', u.email);
                      if (r) { aviso('Usuário excluído.'); carregar(); }
                    },
                  }, 'Excluir')
                )
              )
            )
          )
        ),
        h('button', { type: 'button', class: 'btn', onclick: () => abrirNovoUsuario() }, 'Novo usuário')
      );
    }

    function abrirRedefinirSenhaUsuario(email) {
      const campo = h('input', { type: 'password', id: 'redefinir-senha-usuario', autocomplete: 'new-password' });
      abrirModal({
        titulo: `Redefinir senha de ${email}`,
        corpo: [h('div', {}, h('label', { class: 'rotulo', for: 'redefinir-senha-usuario' }, 'Nova senha (mínimo 6 caracteres)'), campo)],
        acoes: [
          { rotulo: 'Cancelar' },
          {
            rotulo: 'Salvar',
            tipo: 'primario',
            aoClicar: async () => {
              if (campo.value.length < 6) { aviso('A senha precisa ter pelo menos 6 caracteres.', 'erro'); return false; }
              const r = await chamar('nuvemRedefinirSenhaUsuario', email, campo.value);
              if (!r) return false;
              aviso('Senha redefinida.');
            },
          },
        ],
      });
    }

    function abrirNovoUsuario() {
      const campoEmail = h('input', { type: 'email', id: 'novo-usuario-email', autocomplete: 'off' });
      const campoSenha = h('input', { type: 'password', id: 'novo-usuario-senha', autocomplete: 'new-password' });
      const campoPapel = h('select', { id: 'novo-usuario-papel' }, h('option', { value: 'editor' }, 'Editor'), h('option', { value: 'admin' }, 'Administrador'));
      abrirModal({
        titulo: 'Novo usuário',
        corpo: [
          h('div', {}, h('label', { class: 'rotulo', for: 'novo-usuario-email' }, 'E-mail'), campoEmail),
          h('div', {}, h('label', { class: 'rotulo', for: 'novo-usuario-senha' }, 'Senha (mínimo 6 caracteres)'), campoSenha),
          h('div', {}, h('label', { class: 'rotulo', for: 'novo-usuario-papel' }, 'Papel'), campoPapel),
        ],
        acoes: [
          { rotulo: 'Cancelar' },
          {
            rotulo: 'Criar',
            tipo: 'primario',
            aoClicar: async () => {
              if (campoSenha.value.length < 6) { aviso('A senha precisa ter pelo menos 6 caracteres.', 'erro'); return false; }
              const r = await chamar('nuvemCriarUsuario', campoEmail.value, campoSenha.value, campoPapel.value);
              if (!r) return false;
              aviso('Usuário criado.');
              carregar();
            },
          },
        ],
      });
    }

    carregar();
    return painel;
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
          h('h1', {}, 'Configurações'),
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
            h('h2', {}, 'Módulos na pesquisa'),
            h('p', { class: 'ajuda' }, 'Desmarque os módulos que você não quer que apareçam na lista de módulos da aba Pesquisar. Fica salvo neste computador e não muda quando o programa atualizar.'),
            h(
              'div',
              { class: 'lista-checkbox' },
              estado.db.modulos.map((m) => {
                const id = 'modulo-vis-' + m;
                const ocultos = new Set(estado.db.modulosOcultos || []);
                return h(
                  'label',
                  { class: 'checkbox-linha', for: id },
                  h('input', {
                    type: 'checkbox',
                    id,
                    checked: !ocultos.has(m),
                    onchange: async (e) => {
                      const marcado = e.target.checked;
                      const novosOcultos = marcado ? [...ocultos].filter((x) => x !== m) : [...ocultos, m];
                      const r = await chamar('definirModulosOcultos', novosOcultos);
                      if (!r) { e.target.checked = !marcado; return; }
                      atualizarBanco(r.dados);
                      if (!marcado) estado.modulosSelecionados.delete(m); // não deixa a pesquisa presa num módulo escondido
                      render();
                    },
                  }),
                  h('span', {}, m)
                );
              })
            )
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
            h('h2', {}, 'Sincronização'),
            h('p', { class: 'ajuda' }, 'A pesquisa já é compartilhada em tempo real entre os computadores, sem precisar entrar. Entrar (Ctrl+Shift+B) é só pra poder editar.'),
            desenharStatusNuvem(),
            estado.nuvemPapel
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn',
                    onclick: async (e) => {
                      const botao = e.currentTarget;
                      const ok = await confirmar({
                        titulo: 'Enviar dados desta máquina',
                        mensagem: 'Isso faz a nuvem ficar igual aos dados deste computador — o que só existir na nuvem e não existir aqui é apagado de lá. Use isso pra migrar os dados a primeira vez, ou se este computador é quem manda.',
                        rotulo: 'Enviar',
                        perigo: true,
                      });
                      if (!ok) return;
                      botao.disabled = true;
                      const r = await chamar('nuvemEnviarTudo');
                      botao.disabled = false;
                      if (r) aviso(r.dados.alterados ? 'Dados enviados para a nuvem.' : 'A nuvem já estava igual a este computador.');
                    },
                  },
                  'Enviar dados desta máquina para a nuvem'
                )
              : null
          ),
          estado.nuvemPapel === 'admin' ? renderPainelUsuarios() : null,
          estado.nuvemPapel
            ? h(
                'section',
                { class: 'painel' },
                h('h2', {}, 'Minha conta'),
                h('p', { class: 'ajuda' }, `Você está logado como ${estado.nuvemStatus.email}.`),
                h('button', { type: 'button', class: 'btn', onclick: () => abrirAlterarMinhaSenha() }, 'Alterar minha senha')
              )
            : null,
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
    const minimo = 4000;
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
    aplicarTema(estado.db.tema);
    const elTema = document.getElementById('tema-app');
    if (elTema) elTema.replaceChildren(criarInterruptorTema());
    const elVersao = document.getElementById('versao-app');
    if (elVersao) {
      elVersao.replaceChildren(
        h('span', {}, `v${estado.info.versao}`),
        estado.info.novidades
          ? h(
              'span',
              {
                class: 'rel-ajuda',
                tabindex: '0',
                'aria-label': `Novidades da versão ${estado.info.versao}: ${estado.info.novidades}`,
                onmouseenter: (e) => dica.mostrar(e.currentTarget, estado.info.novidades),
                onmouseleave: () => dica.esconder(),
                onfocus: (e) => dica.mostrar(e.currentTarget, estado.info.novidades),
                onblur: () => dica.esconder(),
              },
              '?'
            )
          : null
      );
    }
    montarAbas();
    render();
    esconderPreloader();
    if (estado.db.modulosEscolhidos === false) abrirEscolhaModulosIniciais();
    if (estado.info.avisoInicial) aviso(estado.info.avisoInicial, 'erro', 20000);
    if (typeof window.api.aoAtualizar === 'function') window.api.aoAtualizar(tratarEventoAtualizacao);
    if (typeof window.api.aoDadosNuvem === 'function') {
      window.api.aoDadosNuvem((dados) => {
        // Chega em tempo real quando alguém (nesta máquina ou em outra) muda algo. Se tiver um modal
        // aberto, não atropela o que a pessoa está digitando — atualiza os dados por baixo e aplica
        // a tela assim que ela fechar o modal.
        atualizarBanco(dados.db);
        if (!pilhaModais.length) render();
      });
    }
    if (typeof window.api.aoStatusNuvem === 'function') {
      window.api.aoStatusNuvem((status) => {
        // Só guarda — NÃO redesenha a tela sozinho aqui. Redesenhar chamaria de novo as ações da
        // aba Configurações (lista de usuários, backups...), que se falharem emitem status de novo,
        // e isso reabriria o mesmo ciclo. A tela pega o status atualizado na próxima vez que redesenhar
        // por conta própria (trocar de aba, fazer alguma ação etc.).
        estado.nuvemStatus = status;
      });
    }
    chamarSemAviso('nuvemStatus').then((r) => { if (r.ok) estado.nuvemStatus = r.dados; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
