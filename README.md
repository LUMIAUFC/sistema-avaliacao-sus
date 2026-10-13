# Sistema de Avaliação SUS

Aplicação web, em arquivo único, para aplicar a Escala de Usabilidade do Sistema (System Usability Scale, SUS), calcular a pontuação, apresentar o resultado e exportar PDF e CSV. Funciona inteiramente no navegador, sem servidor, banco de dados ou envio de respostas pela internet.

**Acesse o sistema:** https://lumiaufc.github.io/sistema-avaliacao-sus/

## Objetivos

- Apoiar avaliadores na aplicação padronizada do SUS durante testes de usabilidade.
- Garantir o cálculo correto da pontuação, conforme o algoritmo original de Brooke (1996).
- Gerar registros auditáveis (PDF e CSV) que correspondam exatamente às respostas coletadas.
- Coletar apenas os dados necessários, sem enviar respostas a terceiros.

## Funcionalidades

- Identificação da avaliação: sistema avaliado (obrigatório), versão, código do participante, data e código da avaliação gerados automaticamente, observações do avaliador.
- Questionário com os 10 itens da versão brasileira publicada e escala de 1 a 5, com indicador de progresso.
- Validação: impede o cálculo com itens sem resposta e mostra um resumo com links para cada pendência.
- Cálculo automático da pontuação (0 a 100, em passos de 2,5) com detalhamento da contribuição de cada item.
- Interpretação comparativa com a média de referência de 68 pontos (Sauro, 2011), com fonte e ressalvas.
- Exportação do relatório em PDF e dos dados em CSV, inclusive de rascunhos em andamento.
- Salvamento automático no navegador, recuperação após recarregar ou reabrir, e aviso quando o armazenamento falha.
- Nova avaliação e limpeza dos dados locais sempre com confirmação, com opção de exportar antes de descartar.

## Tecnologias

- HTML, CSS e JavaScript sem framework, reunidos em um único arquivo (`dist/index.html`).
- [jsPDF](https://github.com/parallax/jsPDF) 2.5.1 para gerar o PDF no navegador.
- `localStorage` do navegador para o salvamento local.
- Node.js (`node:test`), [jsdom](https://github.com/jsdom/jsdom) e `pdftotext` para os testes automatizados.

## Como executar

- **Uso direto:** abra `dist/index.html` em um navegador moderno (Chrome, Edge, Firefox ou Safari atualizados). Não há instalação.
- **Publicação:** a cada envio para a branch `main`, o workflow `.github/workflows/pages.yml` publica `dist/index.html` no GitHub Pages. O arquivo também pode ser hospedado em qualquer servidor estático, sem backend.
- A geração de PDF usa a biblioteca jsPDF 2.5.1, carregada do CDN cdnjs. Sem conexão no primeiro acesso, o PDF fica indisponível (a interface avisa) e o CSV continua funcionando. Para uso totalmente offline, substitua a tag `<script src=...jspdf...>` pelo conteúdo de `node_modules/jspdf/dist/jspdf.umd.min.js`.

## Estrutura

```
src/sus-core.js     Instrumento, validação, cálculo, interpretação, CSV, modelo do relatório, persistência (funções puras)
src/sus-pdf.js      Renderização do relatório em PDF (A4) a partir do modelo
src/app.js          Interface: formulário, resultado, diálogos, salvamento automático, downloads
src/template.html   Estrutura e estilos (identidade LUMIA)
src/assets/         Logotipos da UFC e do LUMIA, embutidos no HTML no build
build.js            Junta tudo em dist/index.html (documento completo)
.github/workflows/  Publicação automática no GitHub Pages
tests/core.test.js  Testes unitários (cálculo, validação, CSV, armazenamento)
tests/flow.test.js  Testes do fluxo completo na página real (jsdom), incluindo PDF e CSV gerados
```

## Testes

Requer Node.js 18+ e, para conferir o texto do PDF, `pdftotext` (poppler-utils).

```
npm install
npm run build
npm test
```

Resultado da última execução: **42 testes, 42 aprovados, 0 falhas.** O teste de fluxo grava `test-output/exemplo.pdf` e `test-output/exemplo.csv` para inspeção manual. O CSV gerado também foi importado no LibreOffice Calc (localidade pt-BR), com números e datas reconhecidos corretamente.

## Decisões técnicas

| Decisão | Justificativa |
|---|---|
| HTML único, JavaScript sem framework | Escopo pequeno; abre em qualquer navegador sem build nem servidor. |
| `localStorage`, chave `sus-avaliacao:atual:v1` | Exigido pela especificação. Toda leitura e escrita é protegida; falhas aparecem na interface. |
| Pontuação recalculada ao recuperar | O valor salvo nunca é confiado; é sempre recalculado das respostas brutas. |
| CSV com `;`, decimal com vírgula e BOM UTF-8 | Padrão do Excel em pt-BR; acentos preservados. Em R: `read.csv2`; em pandas: `sep=';', decimal=','`. |
| Proteção contra injeção de fórmulas | Campos que começam com `= + - @` recebem apóstrofo inicial. |
| Interpretação apenas comparativa | Só a média de 68 (Sauro, 2011) é usada, sempre com fonte e sem rótulos "bom"/"ruim". Nenhum percentil ou classificação foi implementado. |
| Polaridade dos itens oculta ao participante | Mostrar "positivo/negativo" durante o preenchimento poderia induzir respostas. Ela aparece no resultado. |
| Identidade visual LUMIA | Cores amostradas do logotipo do laboratório (violeta `#A06CE0`, amarelo `#F8C03C`, ciano `#1CC2DA`) e fio em degradê. Para texto e botões usa-se um violeta mais profundo (`#6A3FC0`), que atinge contraste AA. Tipografia: Montserrat (títulos), Nunito Sans (texto), DM Mono (dados). Os logotipos do LUMIA e da UFC (`src/assets/`) vêm do repositório VProgForms da LUMIAUFC; o brasão da UFC aparece antes do logotipo do LUMIA. |
| Downloads | No claude.ai usa a confirmação de download da plataforma; fora dele, download comum pelo navegador. |

## Itens em português

Transcritos literalmente da Tabela 1 de Lourenço, Carmona e Lopes (2022), versão usada no teste com 100 estudantes, sem sugestões de alteração (alfa de Cronbach 0,76). Observação: no texto do artigo, o item 7 aparece como "...muito rapidamente", mas a tabela publicada traz "...rapidamente". Foi adotada a redação da tabela. Confira a adequação da tradução ao seu público antes de usar em pesquisa.

## Divergências em relação à especificação

1. **Casos de teste incorretos.** A especificação pede "todas as respostas = 1 → SUS 0" e "todas = 5 → SUS 100". Pelo algoritmo de Brooke (1996), ambos resultam em **50**: com todas as respostas em 1, os itens pares contribuem 5 − 1 = 4 cada. Os extremos só ocorrem com respostas alternadas (ímpares 5 e pares 1 → 100; ímpares 1 e pares 5 → 0). Os testes implementam os valores corretos.
2. **Coluna extra no CSV:** `situacao` (concluída ou em andamento), necessária para exportar rascunhos sem confundi-los com avaliações finalizadas, e `versao_aplicacao`.

## Limitações conhecidas

- Os dados ficam só no navegador e perfil usados. Limpar os dados do navegador, usar navegação privada, trocar de dispositivo ou uma falha de armazenamento pode apagá-los. Exporte ao final de cada sessão.
- Mantém uma avaliação por vez (sem histórico local), conforme a versão inicial especificada. Para várias avaliações, exporte o CSV de cada uma e junte as linhas na planilha.
- Acessibilidade: implementada com HTML semântico, `fieldset`/`legend`, navegação por teclado, foco visível, resumo de erros com links e anúncio do resultado por região viva. **Não foram feitos** testes com leitores de tela reais nem auditoria WCAG 2.2 AA completa; não se declara conformidade.
- Os testes de fluxo usam jsdom (sem motor de layout). A renderização foi conferida visualmente em Chromium (celular e desktop, tema escuro), mas não em Safari ou Firefox.
- O PDF usa as fontes padrão do formato (Helvetica, codificação WinAnsi). Caracteres fora desse conjunto em campos de texto livre aparecem como "?".

## Referências

- Brooke, J. (1996). SUS: A "quick and dirty" usability scale. In P. W. Jordan, B. Thomas, B. A. Weerdmeester & I. L. McClelland (Eds.), *Usability Evaluation in Industry* (pp. 189–194). Taylor & Francis.
- Lourenço, D. F., Carmona, E. V. & Lopes, M. H. B. M. (2022). Tradução e adaptação transcultural da System Usability Scale para o português do Brasil. *Aquichan*, 22(2), e2228. https://doi.org/10.5294/aqui.2022.22.2.8
- Sauro, J. (2011). *A Practical Guide to the System Usability Scale: Background, Benchmarks & Best Practices*. Measuring Usability LLC.
