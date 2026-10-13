/*
 * sus-pdf.js — Gera o relatório em PDF (A4) a partir do modelo buildReport().
 * Recebe o construtor jsPDF por parâmetro para funcionar no navegador e no Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SUSPdf = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // As fontes padrão do PDF usam WinAnsi: acentos do português são suportados,
  // mas alguns símbolos matemáticos não. Converte-os para equivalentes seguros.
  function safe(text) {
    return String(text)
      .replace(/−/g, '-')
      .replace(/Σ/g, 'soma')
      .replace(/[^\u0000-ÿ–—‘’“”•…]/g, '?');
  }

  function renderPDF(JsPDF, report) {
    var doc = new JsPDF({ unit: 'mm', format: 'a4' });
    var W = 210, M = 18, CW = W - 2 * M, y = M;
    var ink = [27, 36, 48], muted = [92, 102, 115], rule = [205, 211, 218], accent = [31, 86, 104];

    doc.setProperties({ title: safe(report.title), subject: 'Avaliação SUS ' + report.identification[0][1], creator: 'Sistema de Avaliação SUS ' + report.appVersion });

    function ensure(h) {
      if (y + h > 297 - M - 8) { doc.addPage(); y = M; }
    }
    function text(str, x, opts) {
      opts = opts || {};
      doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
      doc.setFontSize(opts.size || 10);
      doc.setTextColor.apply(doc, opts.color || ink);
      var lines = doc.splitTextToSize(safe(str), opts.width || CW);
      var lh = (opts.size || 10) * 0.42;
      ensure(lines.length * lh);
      doc.text(lines, x, y);
      y += lines.length * lh;
      return lines.length;
    }
    function heading(str) {
      y += 4; ensure(12);
      doc.setDrawColor.apply(doc, rule); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
      y += 6;
      text(str.toUpperCase(), M, { size: 9, bold: true, color: accent });
      y += 2;
    }

    // Cabeçalho
    text(report.title, M, { size: 16, bold: true });
    y += 1;
    text(report.subtitle, M, { size: 10, color: muted });
    y += 3;

    // Identificação
    heading('Identificação da avaliação');
    report.identification.forEach(function (pair) {
      var before = y;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor.apply(doc, muted);
      ensure(5);
      doc.text(safe(pair[0]), M, y);
      y = before;
      text(pair[1], M + 55, { size: 9.5, width: CW - 55 });
      y += 1.2;
    });
    if (report.notes) {
      y += 1;
      text('Observações do avaliador', M, { size: 9.5, bold: true, color: muted });
      y += 0.5;
      text(report.notes, M, { size: 9.5 });
    }

    // Pontuação
    heading('Pontuação SUS');
    ensure(30);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor.apply(doc, ink);
    doc.text(safe(report.scoreText), M, y + 9);
    var sw = doc.getTextWidth(safe(report.scoreText));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor.apply(doc, muted);
    doc.text('/ 100', M + sw + 2, y + 9);
    // escala 0–100
    var bx = M + 60, bw = CW - 60, by = y + 3;
    doc.setFillColor(232, 236, 240); doc.rect(bx, by, bw, 4, 'F');
    doc.setFillColor.apply(doc, accent); doc.rect(bx, by, bw * report.score / 100, 4, 'F');
    var rx = bx + bw * report.interpretation.benchmark / 100;
    doc.setDrawColor.apply(doc, ink); doc.setLineWidth(0.5); doc.line(rx, by - 1.5, rx, by + 5.5);
    doc.setFontSize(7.5); doc.setTextColor.apply(doc, muted);
    doc.text('0', bx, by + 9); doc.text('100', bx + bw, by + 9, { align: 'right' });
    doc.text('média de ref. 68', rx, by + 9, { align: 'center' });
    y += 17;
    report.caveats.forEach(function (c) { text('• ' + c, M, { size: 8.5, color: muted }); y += 0.6; });

    // Interpretação
    heading('Interpretação');
    text(report.interpretation.text, M, { size: 9.5 });
    y += 1;
    text('Fonte da média de referência: ' + report.interpretation.source, M, { size: 8.5, color: muted });

    // Tabela
    heading('Respostas e contribuições');
    var cols = [M, M + 9, M + 104, M + 141, M + 160];
    function tableHeader() {
      ensure(8);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor.apply(doc, muted);
      doc.text('Item', cols[0], y); doc.text('Afirmação', cols[1], y); doc.text('Resposta', cols[2], y);
      doc.text('Regra', cols[3], y); doc.text('Contrib.', W - M, y, { align: 'right' });
      y += 2; doc.setDrawColor.apply(doc, rule); doc.line(M, y, W - M, y); y += 4;
    }
    tableHeader();
    report.items.forEach(function (it) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      var stmt = doc.splitTextToSize(safe(it.text), cols[2] - cols[1] - 3);
      var resp = doc.splitTextToSize(safe(it.response + ' — ' + it.responseLabel), cols[3] - cols[2] - 2);
      var h = Math.max(stmt.length, resp.length) * 3.6 + 2;
      if (y + h > 297 - M - 8) { doc.addPage(); y = M; tableHeader(); }
      doc.setTextColor.apply(doc, ink);
      doc.text(String(it.number), cols[0], y);
      doc.text(stmt, cols[1], y);
      doc.text(resp, cols[2], y);
      doc.setTextColor.apply(doc, muted);
      doc.text(safe(it.rule), cols[3], y);
      doc.setTextColor.apply(doc, ink); doc.setFont('helvetica', 'bold');
      doc.text(String(it.contribution), W - M, y, { align: 'right' });
      y += h;
      doc.setDrawColor(232, 236, 240); doc.line(M, y - 3, W - M, y - 3);
    });

    // Cálculo
    heading('Fórmula de cálculo');
    text(report.formulaPlain, M, { size: 9.5 });
    y += 0.5;
    text(report.calculation, M, { size: 9.5, bold: true });
    y += 0.5;
    text('Itens ímpares (1, 3, 5, 7, 9) são afirmações positivas; itens pares (2, 4, 6, 8, 10) são negativas. Versão do algoritmo: ' + report.algorithmVersion + '.', M, { size: 8.5, color: muted });

    // Referências
    heading('Referências');
    report.references.forEach(function (r) { text(r, M, { size: 8.5 }); y += 1.5; });
    text('Os itens em português seguem a versão brasileira de Lourenço, Carmona e Lopes (2022), Tabela 1.', M, { size: 8.5, color: muted });

    // Rodapé em todas as páginas
    var pages = doc.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, muted);
      doc.text(safe('Sistema de Avaliação SUS v' + report.appVersion + ' · ' + report.identification[0][1]), M, 297 - 10);
      doc.text('Página ' + p + ' de ' + pages, W - M, 297 - 10, { align: 'right' });
    }
    return doc;
  }

  return { renderPDF: renderPDF, safe: safe };
});
