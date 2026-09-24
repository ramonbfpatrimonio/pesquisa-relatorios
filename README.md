# Pesquisa de Relatórios

App desktop (Electron, marca Ativo.ERP) para descobrir **quais relatórios têm determinadas colunas**. Reúne os relatórios de 8 módulos (ATIVO_ADM, ATIVO_LOG, ATIVO_LOG_EFD, ATIVO_INT, ATIVO_COM, ATIVO_COM_EFD, ATIVO_WMS e ATIVO_ECD): 841 relatórios e 891 colunas distintas.

Funciona 100% offline. Não usa Supabase nem nenhum servidor: os dados ficam em arquivos no próprio computador.

## Rodar

```bash
npm install
npm start          # abre o app
npm run dev        # abre com o DevTools
npm test           # testes automatizados
```

## Gerar o instalador (Windows)

```bash
npm run dist
```

O instalador sai em `dist/` (`Pesquisa de Relatórios Setup 1.0.0.exe`). Instala só para o usuário (não pede administrador), cria atalho na área de trabalho com o ícone da Ativo.ERP e mostra a logo na tela de boas-vindas/conclusão.
Rode este comando em um Windows: o instalador `.exe` não pode ser gerado no Linux sem o Wine.

## Onde ficam os dados

| O quê | Onde |
|---|---|
| Banco de dados | `%APPDATA%\PesquisaRelatorios\dados\relatorios.json` |
| Imagens das telas de filtro | `%APPDATA%\PesquisaRelatorios\dados\imagens\` |
| **Backups** | `Documentos\Pesquisa de Relatorios\Backup\` (pode ser trocada na aba *Dados e backup*) |

As pastas são criadas na primeira abertura depois de instalar, já com os 841 relatórios e o primeiro backup.

### Como o backup funciona

- Automático: ao abrir, a cada 10 minutos se algo mudou, e ao fechar. Só cria backup se o arquivo mudou.
- Mantém os 40 automáticos mais recentes. Os manuais e os feitos antes de restaurar/importar nunca são apagados.
- Antes de qualquer restauração ou importação, o estado atual é guardado em um backup.
- A gravação é atômica (arquivo temporário + troca), então uma queda de energia não deixa o arquivo pela metade.
- Se o arquivo de dados for encontrado danificado, ele é guardado com outro nome e o app restaura o último backup válido, avisando na tela.
- As imagens são espelhadas em `Backup\imagens\`.

## Como a pesquisa funciona

Escolha uma ou mais colunas no menu **Pesquisar** (o módulo agora é uma lista, na lateral). Os relatórios aparecem **agrupados pela quantidade de colunas escolhidas que eles têm** (3/3, 2/3, 1/3…). Cada grupo vem resumido atrás de uma seta — clique no cabeçalho para abrir a lista; o melhor grupo já vem aberto. Dá para filtrar por módulo e exportar o resultado em CSV (abre direto no Excel).

Quando um relatório tem uma descrição de funcionalidade cadastrada, aparece um ícone **?** no rodapé do cartão — passe o mouse para ver para que serve o relatório.

## Menus protegidos por senha

As abas **Relatórios**, **Colunas** e **Dados e backup** ficam escondidas por padrão; só **Pesquisar** aparece. `Ctrl+Shift+B` pede uma senha para liberá-las; apertar de novo esconde sem pedir senha. É só uma trava de interface (não é criptografia).

## Duplicidade

O app impede módulos com o mesmo nome (sem diferenciar maiúsculas/minúsculas) e relatórios com o mesmo nome dentro do mesmo módulo. Colunas são sempre normalizadas (maiúsculas, espaços simplificados), então digitar uma coluna já existente — mesmo com acentuação, espaços ou caixa diferentes — reaproveita a coluna já cadastrada em vez de criar outra.

## Atualização automática (GitHub Releases)

O app confere sozinho, ~4 segundos depois de abrir, se existe uma versão mais nova publicada. Se tiver, aparece uma faixa no rodapé da tela com "Baixar agora"; depois de baixar, um "Reiniciar agora" instala e reabre. Isso só funciona no app **instalado** (não no `npm start`/`npm run dev`). Também tem um botão "Verificar atualizações" manual na aba *Dados e backup*.

### Configurar (uma vez)

No `package.json`, dentro de `build.publish`, troque:

```json
"publish": {
  "provider": "github",
  "owner": "SEU_USUARIO_GITHUB",
  "repo": "pesquisa-relatorios"
}
```

pelo seu usuário (ou organização) do GitHub e o nome do repositório onde vai publicar os instaladores.

### Publicar uma versão nova

1. Suba o código para esse repositório no GitHub (pode ser privado).
2. Gere um [token de acesso pessoal](https://github.com/settings/tokens) com permissão **repo** (classic token) ou **Contents: Read and write** (fine-grained).
3. No Windows, na pasta do projeto:
   ```bash
   set GH_TOKEN=seu_token_aqui
   npm version patch   # ou minor/major — sobe o número da versão no package.json
   npm run release
   ```
   Isso builda o instalador **e já publica** como uma nova release no GitHub (rascunho), com os arquivos que o `electron-updater` precisa (`latest.yml` + o `.exe`).
4. No GitHub, na aba *Releases* do repositório, publique o rascunho (ele fica marcado como "Draft" até você confirmar).
5. Quem já tem o app instalado recebe o aviso de atualização na próxima vez que abrir o programa (ou na hora, se estiver com o app aberto e clicar em "Verificar atualizações").

Sem o `GH_TOKEN` configurado, `npm run release` builda mas falha ao tentar publicar — use `npm run dist` nesse caso (builda sem publicar).

## Estrutura

```
main.js              processo principal (janela, pastas, backup automático)
preload.js           ponte segura para a tela (contextIsolation, sem nodeIntegration)
src/store.js         banco em JSON, imagens e backups (sem dependência do Electron)
src/handlers.js      ações que a tela pode pedir (testáveis sem abrir o Electron)
src/busca.js         pesquisa, sugestões e detecção de nomes parecidos
renderer/            interface (HTML, CSS e JS puro, sem build)
renderer/assets/     logo da Ativo.ERP (sidebar e preloader)
data/seed.json       dados extraídos das planilhas, usados na primeira abertura
build/               ícone do app (.ico/.png) e imagem lateral do instalador
test/                testes: busca, armazenamento, handlers e interface (jsdom)
```
