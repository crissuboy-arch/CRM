/**
 * O DESENHO da marca do produto — símbolo e logotipo — como geometria pura.
 *
 * Mora aqui, e não num `.svg` em `public/`, por duas razões que a doutrina de
 * marca própria já paga:
 *
 *  1. `public/` é servido a todo mundo, sempre. Um arquivo fixo ali seria a
 *     marca do PRODUTO na instalação de um revendedor que configurou a dele —
 *     é exatamente o vazamento que `tests/unit/branding.test.ts` vigia. Como
 *     geometria, o desenho só aparece onde um componente decide que a marca em
 *     vigor é a padrão (`marcaEhADoProduto`, em `lib/branding.ts`).
 *  2. O favicon (`app/icon.tsx`) é gerado em runtime pelo `ImageResponse`, que
 *     aceita SVG inline mas não lê arquivo do disco. Um único desenho alimenta
 *     a tela e o ícone — dois arquivos divergiriam na primeira revisão da marca.
 *
 * As cores NÃO estão aqui de propósito: quem desenha escolhe (a tela lê os
 * tokens do tema; o favicon lê a régua do produto). A fonte deste arquivo são
 * os SVGs em `docs/brand/`; ao trocar a arte, regenere os dois lados a partir
 * deles.
 */

/** Glifo com a transformação que o posiciona no `viewBox` do logotipo. */
export type Glifo = { readonly transform: string; readonly d: string };

const CAMINHO_DO_SIMBOLO =
  "M30.0 189.0V27.0H78.74550898203593L141.31437125748502 142.43712574850298V27.0H178.41916167664672V189.0H129.4311377245509L66.86227544910179 73.562874251497V189.0Z";

/** O símbolo: um N com um módulo quadrado destacado na haste. Quadrado de 216. */
export const SIMBOLO = {
  viewBox: "0 0 216 216",
  transform: "translate(0.5 2)",
  d: CAMINHO_DO_SIMBOLO,
  modulo: { x: 26, y: 125, width: 34, height: 34, rx: 4 },
} as const;

/**
 * O logotipo: símbolo + "NEXORA" + "CRM", com o texto já convertido em
 * caminhos — não depende de fonte instalada nem de `@font-face`.
 */
export const LOGOTIPO = {
  viewBox: "51 25 707 211",
  /** Proporção largura/altura do `viewBox`, para dimensionar por altura. */
  proporcao: 707 / 211,
  simbolo: { transform: "translate(44 19) scale(1.05)", d: CAMINHO_DO_SIMBOLO, modulo: SIMBOLO.modulo },
  nome: [
    {
      transform: "translate(272 151) scale(0.11 -0.11)",
      d: "M44 0V668H245L503 192V668H656V0H454L196 476V0Z",
    },
    {
      transform: "translate(353.84 151) scale(0.11 -0.11)",
      d: "M44 0V668H558V529H202V413H419V274H202V139H558V0Z",
    },
    {
      transform: "translate(422.03 151) scale(0.11 -0.11)",
      d: "M10 0 255 343 24 668H213L349 476L486 668H675L444 343L689 0H499L349 211L200 0Z",
    },
    {
      transform: "translate(503.76 151) scale(0.11 -0.11)",
      d: "M381 -12Q279 -12 201.0 31.0Q123 74 79.0 152.0Q35 230 35 334Q35 438 79.0 516.0Q123 594 201.0 637.0Q279 680 381 680Q484 680 562.0 637.0Q640 594 684.5 516.0Q729 438 729 334Q729 230 684.5 152.0Q640 74 562.0 31.0Q484 -12 381 -12ZM381 118Q430 118 471.0 142.5Q512 167 536.5 215.0Q561 263 561 334Q561 405 536.5 453.0Q512 501 471.0 525.5Q430 550 381 550Q333 550 292.0 525.5Q251 501 226.5 453.0Q202 405 202 334Q202 263 226.5 215.0Q251 167 292.0 142.5Q333 118 381 118Z",
    },
    {
      transform: "translate(592.88 151) scale(0.11 -0.11)",
      d: "M44 0V668H301Q388 668 456.5 651.0Q525 634 564.5 589.0Q604 544 604 461Q604 423 590.0 385.5Q576 348 541.5 317.0Q507 286 443 269L637 0H454L273 252H202V0ZM202 384H306Q362 384 399.5 398.5Q437 413 437 459Q437 506 399.5 520.5Q362 535 306 535H202Z",
    },
    {
      transform: "translate(669.49 151) scale(0.11 -0.11)",
      d: "M5 0 258 668H432L685 0H513L473 119H217L177 0ZM260 247H430L344 501Z",
    },
  ] as readonly Glifo[],
  sufixo: [
    {
      transform: "translate(272 202) scale(0.04 -0.04)",
      d: "M369 -12Q265 -12 190.0 30.0Q115 72 75.0 150.0Q35 228 35 334Q35 440 76.5 517.5Q118 595 194.0 637.5Q270 680 373 680Q468 680 538.5 638.0Q609 596 647 525L507 474Q485 515 447.0 532.5Q409 550 368 550Q322 550 284.0 524.5Q246 499 224.0 450.5Q202 402 202 334Q202 229 250.5 173.5Q299 118 370 118Q408 118 448.5 134.0Q489 150 512 193L651 142Q611 71 537.5 29.5Q464 -12 369 -12Z",
    },
    {
      transform: "translate(307.22 202) scale(0.04 -0.04)",
      d: "M44 0V668H301Q388 668 456.5 651.0Q525 634 564.5 589.0Q604 544 604 461Q604 423 590.0 385.5Q576 348 541.5 317.0Q507 286 443 269L637 0H454L273 252H202V0ZM202 384H306Q362 384 399.5 398.5Q437 413 437 459Q437 506 399.5 520.5Q362 535 306 535H202Z",
    },
    {
      transform: "translate(341.6 202) scale(0.04 -0.04)",
      d: "M44 0V668H281L420 189L561 668H798V0H644V525L485 0H355L197 525V0Z",
    },
  ] as readonly Glifo[],
} as const;

/**
 * As cores da marca do produto, por tema — os mesmos graus da régua
 * (`regua-do-produto.ts`): azul 600/400 para o símbolo, ardósia 900/50
 * para o nome e ardósia 500/400 para o "CRM". A arte-fonte é
 * `docs/brand/nexora-logotipo.svg` (gerada da Atkinson Hyperlegible 700,
 * a fonte do produto, em 2026-10-20).
 */
export const CORES_DA_MARCA = {
  claro: { simbolo: "#2563eb", nome: "#0f172a", sufixo: "#64748b" },
  escuro: { simbolo: "#60a5fa", nome: "#f8fafc", sufixo: "#94a3b8" },
} as const;
