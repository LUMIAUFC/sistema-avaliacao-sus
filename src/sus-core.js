/*
 * sus-core.js — Núcleo do Sistema de Avaliação SUS
 * Funções puras: instrumento, validação, cálculo, interpretação, CSV,
 * modelo do relatório e persistência local. Sem dependência de DOM.
 * Funciona no navegador (window.SUSCore) e no Node (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SUSCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var APP_VERSION = '1.0.0';
  var ALGORITHM_VERSION = 'SUS-Brooke1996-v1';
  var STORAGE_KEY = 'sus-avaliacao:atual:v1';

  /* Itens: versão brasileira publicada por Lourenço, Carmona e Lopes (2022),
     Tabela 1, transcrita literalmente. Polaridade: ímpares positivos, pares negativos. */
  var ITEMS = [
    'Eu acho que gostaria de usar esse sistema frequentemente.',
    'Eu achei esse sistema desnecessariamente complexo.',
    'Eu achei esse sistema fácil de usar.',
    'Eu achei que precisaria de ajuda de uma pessoa técnica para ser capaz de usar esse sistema.',
    'Eu achei que as várias funções desse sistema foram bem integradas.',
    'Eu acho que o sistema apresenta muita inconsistência.',
    'Eu imagino que a maioria das pessoas pode aprender a usar esse sistema rapidamente.',
    'Eu achei esse sistema muito pesado para usar.',
    'Eu me senti muito seguro usando o sistema.',
    'Eu precisei aprender muitas coisas antes que pudesse utilizar esse sistema.'
  ];

  var OPTIONS = [
    { value: 1, label: 'Discordo totalmente' },
    { value: 2, label: 'Discordo' },
    { value: 3, label: 'Nem concordo nem discordo' },
    { value: 4, label: 'Concordo' },
    { value: 5, label: 'Concordo totalmente' }
  ];

  var REFERENCES = {
    instrument: 'Brooke, J. (1996). SUS: A "quick and dirty" usability scale. In P. W. Jordan, B. Thomas, B. A. Weerdmeester & I. L. McClelland (Eds.), Usability Evaluation in Industry (pp. 189–194). London: Taylor & Francis.',
    translation: 'Lourenço, D. F., Carmona, E. V. & Lopes, M. H. B. M. (2022). Tradução e adaptação transcultural da System Usability Scale para o português do Brasil. Aquichan, 22(2), e2228. https://doi.org/10.5294/aqui.2022.22.2.8',
    benchmark: 'Sauro, J. (2011). A Practical Guide to the System Usability Scale: Background, Benchmarks & Best Practices. Denver, CO: Measuring Usability LLC.'
  };

  var BENCHMARK_MEAN = 68;

  function isPolarityPositive(index) { return index % 2 === 0; } // índice 0 = item 1 (ímpar)

  function isValidResponse(v) {
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
  }

  /** Verifica se as respostas estão completas e no intervalo 1..5. */
  function validateResponses(responses) {
    var missing = [], invalid = [];
    if (!Array.isArray(responses) || responses.length !== 10) {
      return { valid: false, missing: [], invalid: [], structural: true };
    }
    responses.forEach(function (v, i) {
      if (v === null || v === undefined || v === '') missing.push(i + 1);
      else if (!isValidResponse(v)) invalid.push(i + 1);
    });
    return { valid: missing.length === 0 && invalid.length === 0, missing: missing, invalid: invalid, structural: false };
  }

  function contributionFor(index, response) {
    return isPolarityPositive(index) ? response - 1 : 5 - response;
  }

  /**
   * Calcula a pontuação SUS. Lança erro se houver respostas ausentes ou inválidas.
   * Retorna { score, sum, contributions }. Nenhum arredondamento é aplicado:
   * soma inteira × 2,5 é sempre múltiplo exato de 2,5.
   */
  function calculateSUS(responses) {
    var check = validateResponses(responses);
    if (check.structural) throw new Error('O questionário deve conter exatamente 10 respostas.');
    if (check.missing.length) throw new Error('Itens sem resposta: ' + check.missing.join(', ') + '.');
    if (check.invalid.length) throw new Error('Respostas fora do intervalo de 1 a 5 nos itens: ' + check.invalid.join(', ') + '.');
    var contributions = responses.map(function (r, i) { return contributionFor(i, r); });
    var sum = contributions.reduce(function (a, b) { return a + b; }, 0);
    return { score: sum * 2.5, sum: sum, contributions: contributions };
  }

  /** Interpretação comparativa, sem rótulos de qualidade. */
  function interpret(score) {
    var diff = score - BENCHMARK_MEAN;
    var position;
    if (diff > 0) position = 'acima';
    else if (diff < 0) position = 'abaixo';
    else position = 'igual';
    var text;
    if (position === 'igual') {
      text = 'A pontuação coincide com a média de referência de 68 pontos.';
    } else {
      text = 'A pontuação está ' + formatNumber(Math.abs(diff)) + ' pontos ' + position + ' da média de referência de 68 pontos.';
    }
    text += ' Essa média foi obtida por Sauro (2011) a partir de cerca de 500 estudos e serve apenas como comparação. Ela não é um limite de aprovação, e uma única resposta individual não permite generalizar a usabilidade percebida do sistema.';
    return { benchmark: BENCHMARK_MEAN, difference: diff, position: position, text: text, source: REFERENCES.benchmark };
  }

  function formatNumber(n) {
    // pt-BR, sem arredondar: valores SUS são múltiplos de 2,5 (no máx. 1 casa decimal).
    return String(n).replace('.', ',');
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return formatDate(iso) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function generateCode(now, rand) {
    var d = now || new Date();
    var r = rand || Math.random;
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var suffix = '';
    for (var i = 0; i < 4; i++) suffix += chars[Math.floor(r() * chars.length)];
    return 'SUS-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + suffix;
  }

  function createEvaluation(now, rand) {
    var d = now || new Date();
    return {
      schema: 1,
      code: generateCode(d, rand),
      createdAt: d.toISOString(),
      updatedAt: d.toISOString(),
      system: '',
      participant: '',
      systemVersion: '',
      notes: '',
      responses: [null, null, null, null, null, null, null, null, null, null],
      status: 'em_andamento',
      submittedAt: null,
      result: null,
      exportedAt: null
    };
  }

  function sanitizeText(value, max) {
    if (typeof value !== 'string') return '';
    // remove caracteres de controle, mantém quebras de linha nas observações
    var s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return s.slice(0, max);
  }

  var LIMITS = { system: 120, participant: 40, systemVersion: 40, notes: 2000 };

  function validateIdentification(ev) {
    var errors = {};
    if (!ev.system || !ev.system.trim()) errors.system = 'Informe o nome ou código do sistema avaliado.';
    if (ev.participant && /[^A-Za-z0-9_\-.]/.test(ev.participant.trim())) {
      errors.participant = 'Use apenas letras sem acento, números, hífen, ponto ou sublinhado (ex.: P001).';
    }
    return errors;
  }

  /** Normaliza um objeto lido do armazenamento. Retorna null se for irrecuperável. */
  function normalizeEvaluation(raw) {
    if (!raw || typeof raw !== 'object' || raw.schema !== 1) return null;
    if (!Array.isArray(raw.responses) || raw.responses.length !== 10) return null;
    var ev = createEvaluation(new Date(raw.createdAt || Date.now()));
    ev.code = typeof raw.code === 'string' && /^SUS-\d{8}-[A-Z0-9]{4}$/.test(raw.code) ? raw.code : ev.code;
    ev.createdAt = raw.createdAt || ev.createdAt;
    ev.updatedAt = raw.updatedAt || ev.updatedAt;
    ev.system = sanitizeText(raw.system, LIMITS.system);
    ev.participant = sanitizeText(raw.participant, LIMITS.participant);
    ev.systemVersion = sanitizeText(raw.systemVersion, LIMITS.systemVersion);
    ev.notes = sanitizeText(raw.notes, LIMITS.notes);
    ev.responses = raw.responses.map(function (v) { return isValidResponse(v) ? v : null; });
    ev.exportedAt = raw.exportedAt || null;
    if (raw.status === 'concluida' && validateResponses(ev.responses).valid) {
      ev.status = 'concluida';
      ev.submittedAt = raw.submittedAt || ev.updatedAt;
      ev.result = calculateSUS(ev.responses); // recalcula: nunca confia no valor salvo
    }
    return ev;
  }

  function answeredCount(responses) {
    return responses.filter(function (v) { return isValidResponse(v); }).length;
  }

  /* ---------- CSV ---------- */

  var CSV_SEPARATOR = ';';
  var CSV_HEADERS = ['codigo_avaliacao', 'sistema_avaliado', 'codigo_participante', 'data_avaliacao',
    'versao_sistema_avaliado', 'situacao',
    'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10',
    'pontuacao_sus', 'versao_algoritmo', 'versao_aplicacao'];

  /** Escapa um campo para CSV e neutraliza injeção de fórmulas em planilhas. */
  function csvField(value) {
    var s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** Gera o CSV (UTF-8 com BOM, separador ";", decimal com vírgula — padrão do Excel em pt-BR). */
  function buildCSV(ev) {
    var complete = validateResponses(ev.responses).valid;
    var score = '';
    if (ev.status === 'concluida' && complete) score = formatNumber(calculateSUS(ev.responses).score);
    var row = [ev.code, ev.system.trim(), ev.participant.trim(), formatDate(ev.submittedAt || ev.createdAt),
      ev.systemVersion.trim(), ev.status === 'concluida' ? 'concluida' : 'em andamento']
      .concat(ev.responses.map(function (v) { return v === null ? '' : v; }))
      .concat([score, ALGORITHM_VERSION, APP_VERSION]);
    return '﻿' + CSV_HEADERS.join(CSV_SEPARATOR) + '\r\n' + row.map(csvField).join(CSV_SEPARATOR) + '\r\n';
  }

  /** Lê um CSV gerado por buildCSV (usado nos testes de integridade). */
  function parseCSV(text) {
    var t = text.replace(/^﻿/, '');
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (inQ) {
        if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === CSV_SEPARATOR) { row.push(field); field = ''; }
      else if (c === '\r') { /* ignora */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ---------- Relatório ---------- */

  /** Modelo de dados do relatório, compartilhado pela tela e pelo PDF. */
  function buildReport(ev) {
    var calc = calculateSUS(ev.responses);
    return {
      title: 'Relatório de Avaliação de Usabilidade — SUS',
      subtitle: 'Escala de Usabilidade do Sistema (System Usability Scale)',
      identification: [
        ['Código da avaliação', ev.code],
        ['Sistema avaliado', ev.system.trim()],
        ['Versão do sistema avaliado', ev.systemVersion.trim() || 'Não informada'],
        ['Código do participante', ev.participant.trim() || 'Não informado'],
        ['Data da avaliação', formatDateTime(ev.submittedAt || ev.createdAt)]
      ],
      notes: ev.notes.trim(),
      score: calc.score,
      scoreText: formatNumber(calc.score),
      sum: calc.sum,
      items: ITEMS.map(function (text, i) {
        return {
          number: i + 1,
          text: text,
          polarity: isPolarityPositive(i) ? 'positivo' : 'negativo',
          response: ev.responses[i],
          responseLabel: OPTIONS[ev.responses[i] - 1].label,
          contribution: calc.contributions[i],
          rule: isPolarityPositive(i) ? 'resposta − 1' : '5 − resposta'
        };
      }),
      formula: 'SUS = 2,5 × [Σ ímpares (resposta − 1) + Σ pares (5 − resposta)]',
      formulaPlain: 'SUS = 2,5 × [soma dos itens ímpares (resposta − 1) + soma dos itens pares (5 − resposta)]',
      calculation: 'Soma das contribuições = ' + calc.sum + '; ' + calc.sum + ' × 2,5 = ' + formatNumber(calc.score),
      interpretation: interpret(calc.score),
      caveats: [
        'A pontuação SUS varia de 0 a 100, mas não é uma porcentagem.',
        'A contribuição de cada item (0 a 4) serve apenas para transparência do cálculo; itens isolados não são medidas validadas de usabilidade.'
      ],
      references: [REFERENCES.instrument, REFERENCES.translation, REFERENCES.benchmark],
      algorithmVersion: ALGORITHM_VERSION,
      appVersion: APP_VERSION
    };
  }

  /* ---------- Persistência local ---------- */

  /**
   * Envolve um objeto com interface Storage (localStorage ou simulação).
   * Nunca lança: retorna { ok, error } para que a interface informe falhas.
   */
  function createStore(storage, key) {
    var k = key || STORAGE_KEY;
    return {
      key: k,
      available: function () {
        try {
          if (!storage) return false;
          var probe = k + ':teste';
          storage.setItem(probe, '1');
          storage.removeItem(probe);
          return true;
        } catch (e) { return false; }
      },
      save: function (ev) {
        try {
          if (!storage) throw new Error('Armazenamento indisponível');
          var payload = JSON.stringify(ev);
          storage.setItem(k, payload);
          if (storage.getItem(k) !== payload) throw new Error('Verificação de gravação falhou');
          return { ok: true };
        } catch (e) { return { ok: false, error: e && e.name === 'QuotaExceededError' ? 'cota' : 'indisponivel' }; }
      },
      load: function () {
        try {
          if (!storage) return { ok: false, error: 'indisponivel', evaluation: null };
          var raw = storage.getItem(k);
          if (!raw) return { ok: true, evaluation: null };
          var ev = normalizeEvaluation(JSON.parse(raw));
          if (!ev) return { ok: false, error: 'corrompido', evaluation: null };
          return { ok: true, evaluation: ev };
        } catch (e) { return { ok: false, error: e instanceof SyntaxError ? 'corrompido' : 'indisponivel', evaluation: null }; }
      },
      clear: function () {
        try { if (storage) storage.removeItem(k); return { ok: true }; }
        catch (e) { return { ok: false, error: 'indisponivel' }; }
      }
    };
  }

  function exportFilename(ev, ext) {
    var base = (ev.system || 'sistema').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'sistema';
    var part = ev.participant ? '_' + ev.participant.replace(/[^A-Za-z0-9_\-.]/g, '') : '';
    return 'sus_' + base + part + '_' + ev.code + '.' + ext;
  }

  return {
    APP_VERSION: APP_VERSION,
    ALGORITHM_VERSION: ALGORITHM_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    ITEMS: ITEMS,
    OPTIONS: OPTIONS,
    REFERENCES: REFERENCES,
    BENCHMARK_MEAN: BENCHMARK_MEAN,
    LIMITS: LIMITS,
    isValidResponse: isValidResponse,
    validateResponses: validateResponses,
    calculateSUS: calculateSUS,
    interpret: interpret,
    formatNumber: formatNumber,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    generateCode: generateCode,
    createEvaluation: createEvaluation,
    sanitizeText: sanitizeText,
    validateIdentification: validateIdentification,
    normalizeEvaluation: normalizeEvaluation,
    answeredCount: answeredCount,
    csvField: csvField,
    buildCSV: buildCSV,
    parseCSV: parseCSV,
    CSV_HEADERS: CSV_HEADERS,
    buildReport: buildReport,
    createStore: createStore,
    exportFilename: exportFilename
  };
});
