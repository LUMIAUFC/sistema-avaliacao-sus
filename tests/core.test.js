const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/sus-core.js');

const all = (v) => Array(10).fill(v);

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m
  };
}
function brokenStorage() {
  return {
    getItem() { throw new Error('SecurityError'); },
    setItem() { const e = new Error('cheio'); e.name = 'QuotaExceededError'; throw e; },
    removeItem() { throw new Error('SecurityError'); }
  };
}

test('instrumento: 10 itens e 5 opções', () => {
  assert.equal(C.ITEMS.length, 10);
  assert.deepEqual(C.OPTIONS.map((o) => o.value), [1, 2, 3, 4, 5]);
  assert.equal(C.OPTIONS[0].label, 'Discordo totalmente');
  assert.equal(C.OPTIONS[4].label, 'Concordo totalmente');
});

// ATENÇÃO: a especificação pede "todas 1 → 0" e "todas 5 → 100", mas isso contradiz
// o próprio algoritmo de Brooke (1996). Com todas as respostas iguais a 1, os ímpares
// contribuem 0 e os pares contribuem 4 cada (5 − 1) → 20 × 2,5 = 50. O mesmo vale para 5.
// Os extremos 0 e 100 só ocorrem com respostas alternadas (testes abaixo).
test('cálculo: todas as respostas 1 → 50 (não 0)', () => assert.equal(C.calculateSUS(all(1)).score, 50));
test('cálculo: todas as respostas 3 → 50', () => assert.equal(C.calculateSUS(all(3)).score, 50));
test('cálculo: todas as respostas 5 → 50 (não 100)', () => assert.equal(C.calculateSUS(all(5)).score, 50));
test('cálculo: padrão ideal (ímpares 5, pares 1) → 100', () => {
  assert.equal(C.calculateSUS([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]).score, 100);
});
test('cálculo: padrão pior (ímpares 1, pares 5) → 0', () => {
  assert.equal(C.calculateSUS([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]).score, 0);
});
test('cálculo: exemplo misto confere com cálculo manual', () => {
  // contribuições: 3,3,3,2,2,3,4,3,3,1 = 27 → 67,5
  const r = C.calculateSUS([4, 2, 4, 3, 3, 2, 5, 2, 4, 4]);
  assert.deepEqual(r.contributions, [3, 3, 3, 2, 2, 3, 4, 3, 3, 1]);
  assert.equal(r.sum, 27);
  assert.equal(r.score, 67.5);
});
test('cálculo: resultado sempre múltiplo de 2,5 e entre 0 e 100 (amostra exaustiva aleatória)', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let n = 0; n < 5000; n++) {
    const resp = Array.from({ length: 10 }, () => 1 + Math.floor(rnd() * 5));
    const { score } = C.calculateSUS(resp);
    assert.ok(score >= 0 && score <= 100);
    assert.equal((score * 2) % 5, 0);
    const manual = 2.5 * resp.reduce((s, v, i) => s + (i % 2 === 0 ? v - 1 : 5 - v), 0);
    assert.equal(score, manual);
  }
});
test('cálculo: determinístico', () => {
  const r = [2, 3, 4, 1, 5, 2, 3, 4, 1, 5];
  assert.deepEqual(C.calculateSUS(r), C.calculateSUS(r.slice()));
});
test('cálculo: respostas ausentes impedem o cálculo', () => {
  assert.throws(() => C.calculateSUS([1, 2, 3, null, 5, 1, 2, 3, 4, 5]), /Itens sem resposta: 4/);
  assert.throws(() => C.calculateSUS(all(null)), /sem resposta/);
});
test('cálculo: respostas fora de 1..5 são rejeitadas', () => {
  for (const bad of [0, 6, -1, 2.5, '3', NaN]) {
    const r = all(3); r[6] = bad;
    assert.throws(() => C.calculateSUS(r), /fora do intervalo|sem resposta/, `valor ${bad}`);
  }
});
test('cálculo: quantidade errada de itens é rejeitada', () => {
  assert.throws(() => C.calculateSUS([1, 2, 3]), /exatamente 10/);
});

test('validação: lista itens ausentes e inválidos', () => {
  const v = C.validateResponses([1, null, 3, 9, 5, null, 2, 3, 4, 5]);
  assert.equal(v.valid, false);
  assert.deepEqual(v.missing, [2, 6]);
  assert.deepEqual(v.invalid, [4]);
});

test('identificação: sistema obrigatório e código de participante sem dados pessoais', () => {
  const ev = C.createEvaluation();
  assert.ok(C.validateIdentification(ev).system);
  ev.system = 'Moodle';
  assert.deepEqual(C.validateIdentification(ev), {});
  ev.participant = 'João Silva';
  assert.ok(C.validateIdentification(ev).participant);
  ev.participant = 'P001';
  assert.deepEqual(C.validateIdentification(ev), {});
});

test('interpretação: sem rótulos de qualidade e com fonte', () => {
  const i = C.interpret(72.5);
  assert.equal(i.position, 'acima');
  assert.match(i.text, /4,5 pontos acima/);
  assert.match(i.text, /não é um limite de aprovação/);
  assert.doesNotMatch(i.text, /\b(bom|ruim|excelente|péssimo)\b/i);
  assert.match(i.source, /Sauro/);
  assert.equal(C.interpret(68).position, 'igual');
  assert.equal(C.interpret(40).position, 'abaixo');
});

test('CSV: cabeçalho, BOM, separador e valores conferem com as respostas', () => {
  const ev = C.createEvaluation(new Date(2026, 9, 13, 10, 0), () => 0);
  Object.assign(ev, { system: 'Plataforma de ensino', participant: 'P001', systemVersion: '2.1',
    responses: [4, 2, 4, 3, 3, 2, 5, 2, 4, 4], status: 'concluida', submittedAt: new Date(2026, 9, 13, 10, 5).toISOString() });
  const csv = C.buildCSV(ev);
  assert.ok(csv.startsWith('﻿'));
  const rows = C.parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], C.CSV_HEADERS);
  const rec = Object.fromEntries(rows[0].map((h, i) => [h, rows[1][i]]));
  assert.equal(rec.codigo_avaliacao, 'SUS-20261013-AAAA');
  assert.equal(rec.sistema_avaliado, 'Plataforma de ensino');
  assert.equal(rec.codigo_participante, 'P001');
  assert.equal(rec.data_avaliacao, '13/10/2026');
  assert.equal(rec.situacao, 'concluida');
  assert.deepEqual(['Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10'].map((q) => Number(rec[q])), ev.responses);
  assert.equal(rec.pontuacao_sus, '67,5');
  assert.equal(rec.versao_algoritmo, C.ALGORITHM_VERSION);
});

test('CSV: avaliação em andamento não traz pontuação', () => {
  const ev = C.createEvaluation();
  ev.system = 'X'; ev.responses[0] = 5;
  const rows = C.parseCSV(C.buildCSV(ev));
  const rec = Object.fromEntries(rows[0].map((h, i) => [h, rows[1][i]]));
  assert.equal(rec.situacao, 'em andamento');
  assert.equal(rec.pontuacao_sus, '');
  assert.equal(rec.Q1, '5');
  assert.equal(rec.Q2, '');
});

test('CSV: neutraliza fórmulas e escapa separadores, aspas e quebras de linha', () => {
  assert.equal(C.csvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(C.csvField('+55'), "'+55");
  assert.equal(C.csvField('-1'), "'-1");
  assert.equal(C.csvField('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(C.csvField('a;b'), '"a;b"');
  assert.equal(C.csvField('linha1\nlinha2'), '"linha1\nlinha2"');
  assert.equal(C.csvField('Avaliação ção'), 'Avaliação ção');
  const ev = C.createEvaluation();
  ev.system = '=cmd|\' /C calc\'!A0';
  const rows = C.parseCSV(C.buildCSV(ev));
  assert.ok(rows[1][1].startsWith("'="));
});

test('relatório: modelo coerente com o cálculo', () => {
  const ev = C.createEvaluation();
  Object.assign(ev, { system: 'App', responses: [5, 1, 5, 1, 5, 1, 5, 1, 5, 1], status: 'concluida' });
  const rep = C.buildReport(ev);
  assert.equal(rep.score, 100);
  assert.equal(rep.items.length, 10);
  assert.equal(rep.items.reduce((s, i) => s + i.contribution, 0), 40);
  assert.equal(rep.items[1].polarity, 'negativo');
  assert.equal(rep.identification[3][1], 'Não informado');
  assert.equal(rep.references.length, 3);
});

test('armazenamento: salva, recupera parcial e recalcula concluída', () => {
  const st = memoryStorage();
  const store = C.createStore(st);
  const ev = C.createEvaluation();
  ev.system = 'Sistema A'; ev.systemVersion = '1.0'; ev.responses[0] = 4; ev.responses[1] = 2;
  assert.deepEqual(store.save(ev), { ok: true });
  const back = store.load();
  assert.equal(back.ok, true);
  assert.equal(back.evaluation.system, 'Sistema A');
  assert.equal(back.evaluation.systemVersion, '1.0');
  assert.deepEqual(back.evaluation.responses.slice(0, 3), [4, 2, null]);
  assert.equal(back.evaluation.status, 'em_andamento');
  // altera resposta → salvamento atualizado
  back.evaluation.responses[0] = 1;
  store.save(back.evaluation);
  assert.equal(store.load().evaluation.responses[0], 1);
});

test('armazenamento: valor de pontuação adulterado é ignorado e recalculado', () => {
  const st = memoryStorage();
  const store = C.createStore(st);
  const ev = C.createEvaluation();
  Object.assign(ev, { system: 'S', responses: all(3), status: 'concluida', result: { score: 99 } });
  store.save(ev);
  assert.equal(store.load().evaluation.result.score, 50);
});

test('armazenamento: concluída com respostas incompletas volta a "em andamento"', () => {
  const st = memoryStorage();
  const store = C.createStore(st);
  const ev = C.createEvaluation();
  Object.assign(ev, { system: 'S', status: 'concluida' });
  ev.responses[0] = 7;
  store.save(ev);
  const back = store.load().evaluation;
  assert.equal(back.status, 'em_andamento');
  assert.equal(back.responses[0], null);
});

test('armazenamento: falhas são comunicadas, nunca lançadas', () => {
  const store = C.createStore(brokenStorage());
  assert.equal(store.available(), false);
  assert.deepEqual(store.save(C.createEvaluation()), { ok: false, error: 'cota' });
  assert.equal(store.load().ok, false);
  assert.equal(store.clear().ok, false);
  const none = C.createStore(null);
  assert.equal(none.save(C.createEvaluation()).ok, false);
});

test('armazenamento: dado corrompido é detectado', () => {
  const st = memoryStorage();
  st.setItem(C.STORAGE_KEY, '{nao é json');
  assert.equal(C.createStore(st).load().error, 'corrompido');
  st.setItem(C.STORAGE_KEY, JSON.stringify({ schema: 9 }));
  assert.equal(C.createStore(st).load().error, 'corrompido');
});

test('armazenamento: limpar remove apenas a chave da aplicação', () => {
  const st = memoryStorage();
  st.setItem('outra-app', 'x');
  const store = C.createStore(st);
  store.save(C.createEvaluation());
  store.clear();
  assert.equal(st.getItem(C.STORAGE_KEY), null);
  assert.equal(st.getItem('outra-app'), 'x');
});

test('nome de arquivo sem acentos nem caracteres especiais', () => {
  const ev = C.createEvaluation(new Date(2026, 0, 2), () => 0);
  ev.system = 'Plataforma de Ensino Ágil!'; ev.participant = 'P001';
  assert.equal(C.exportFilename(ev, 'pdf'), 'sus_plataforma-de-ensino-agil_P001_SUS-20260102-AAAA.pdf');
});
