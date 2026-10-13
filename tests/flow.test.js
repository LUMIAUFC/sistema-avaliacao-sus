// Testes do fluxo completo na interface real (dist/index.html) usando jsdom.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');
const jspdf = require('jspdf');
const C = require('../src/sus-core.js');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8')
  .replace(/<script src="https:\/\/cdnjs[^"]+"><\/script>/, ''); // jsPDF é injetado a partir do node_modules
const OUT = path.join(__dirname, '..', 'test-output');
fs.mkdirSync(OUT, { recursive: true });

function sharedStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
}
function failingStorage() {
  return {
    getItem: () => null,
    setItem: () => { const e = new Error('cheio'); e.name = 'QuotaExceededError'; throw e; },
    removeItem: () => {}
  };
}

/** Abre a página como se fosse um novo carregamento no mesmo navegador. */
function open(storage, opts = {}) {
  const saved = [];
  const network = [];
  const dom = new JSDOM('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body>' + PAGE + '</body></html>', {
    runScripts: 'dangerously',
    url: 'https://artefato.local/',
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', { configurable: true, get: () => storage });
      win.jspdf = opts.noPdf ? undefined : jspdf;
      win.__SUS_SAVE_HOOK__ = (filename, data, mime) => { saved.push({ filename, data, mime }); return 'ok'; };
      win.fetch = (...a) => { network.push(['fetch', a]); return Promise.reject(new Error('bloqueado')); };
      win.XMLHttpRequest = function () { network.push(['xhr']); throw new Error('bloqueado'); };
      win.navigator.sendBeacon = (...a) => { network.push(['beacon', a]); return false; };
      win.HTMLElement.prototype.scrollIntoView = function () {};
    }
  });
  const w = dom.window, d = w.document;
  const api = {
    dom, w, d, saved, network,
    q: (s) => d.querySelector(s),
    qa: (s) => [...d.querySelectorAll(s)],
    text: () => d.getElementById('app').textContent,
    type(id, value) { const el = d.getElementById(id); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); },
    answer(n, v) { const el = d.querySelector(`input[name="q${n}"][value="${v}"]`); el.checked = true; el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    answerAll(arr) { arr.forEach((v, i) => api.answer(i + 1, v)); },
    click(sel) { const el = typeof sel === 'string' ? d.querySelector(sel) : sel; assert.ok(el, 'elemento não encontrado: ' + sel); el.click(); },
    submit() { d.getElementById('sus-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); },
    dialogButton(label) { return [...d.querySelectorAll('#dialog-root button')].find((b) => b.textContent === label); },
    tick: (ms = 30) => new Promise((r) => setTimeout(r, ms)),
    stored: () => JSON.parse(storage.getItem(C.STORAGE_KEY))
  };
  return api;
}

test('interface: 10 itens com 5 opções rotuladas e agrupadas', () => {
  const p = open(sharedStorage());
  const sets = p.qa('fieldset.item');
  assert.equal(sets.length, 10);
  sets.forEach((fs, i) => {
    assert.equal(fs.querySelector('legend').textContent.replace(/^\d+/, ''), C.ITEMS[i]);
    const radios = fs.querySelectorAll('input[type=radio]');
    assert.equal(radios.length, 5);
    radios.forEach((r) => assert.ok(r.closest('label').textContent.trim().length > 1));
    assert.equal(new Set([...radios].map((r) => r.name)).size, 1, 'resposta única por item');
  });
  assert.match(p.text(), /0 de 10 itens respondidos/);
});

test('preenchimento parcial + recarregar mantém respostas e identificação', () => {
  const st = sharedStorage();
  const a = open(st);
  a.type('f-system', 'Plataforma de ensino');
  a.type('f-systemVersion', '2.1');
  a.type('f-participant', 'P007');
  a.answer(1, 4); a.answer(2, 2); a.answer(5, 3);
  assert.match(a.text(), /3 de 10 itens respondidos/);
  assert.match(a.text(), /Salvo neste navegador/);
  a.w.close();

  const b = open(st); // "recarregar" / reabrir o navegador
  assert.equal(b.d.getElementById('f-system').value, 'Plataforma de ensino');
  assert.equal(b.d.getElementById('f-systemVersion').value, '2.1');
  assert.equal(b.d.getElementById('f-participant').value, 'P007');
  assert.ok(b.q('input[name="q1"][value="4"]').checked);
  assert.ok(b.q('input[name="q2"][value="2"]').checked);
  assert.ok(b.q('input[name="q5"][value="3"]').checked);
  assert.ok(!b.q('input[name="q3"]:checked'));
  assert.match(b.text(), /Avaliação recuperada deste navegador/);
  assert.match(b.text(), /3 de 10 itens respondidos/);
});

test('alterar uma resposta atualiza o salvamento local', () => {
  const st = sharedStorage();
  const p = open(st);
  p.answer(3, 2);
  assert.equal(p.stored().responses[2], 2);
  p.answer(3, 5);
  assert.equal(p.stored().responses[2], 5);
});

test('avaliação incompleta não gera pontuação e aponta os itens faltantes', () => {
  const p = open(sharedStorage());
  p.type('f-system', 'App X');
  p.answerAll([4, 2, 4, 2, 4, null, null, null, null, null].map((v) => v ?? undefined).slice(0, 5));
  p.submit();
  assert.ok(p.q('#error-summary'), 'resumo de erros exibido');
  const missing = p.qa('#error-summary li').map((li) => li.textContent);
  assert.deepEqual(missing, ['Item 6 sem resposta', 'Item 7 sem resposta', 'Item 8 sem resposta', 'Item 9 sem resposta', 'Item 10 sem resposta']);
  assert.equal(p.qa('fieldset.item.missing').length, 5);
  assert.equal(p.q('#result-title'), null);
  assert.equal(p.stored().status, 'em_andamento');
  assert.equal(p.stored().result, null);
  assert.equal(p.d.activeElement.id, 'error-summary');
});

test('sistema avaliado é obrigatório', () => {
  const p = open(sharedStorage());
  p.answerAll([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  p.submit();
  assert.match(p.q('#error-summary').textContent, /Informe o nome ou código do sistema avaliado/);
  assert.equal(p.q('#f-system').getAttribute('aria-invalid'), 'true');
});

test('avaliação completa: pontuação correta, CSV e PDF coerentes com as respostas', async () => {
  const st = sharedStorage();
  const p = open(st);
  const resp = [4, 2, 4, 3, 3, 2, 5, 2, 4, 4]; // 67,5
  p.type('f-system', 'Plataforma de ensino');
  p.type('f-participant', 'P001');
  p.type('f-systemVersion', '3.0-beta');
  p.type('f-notes', 'Sessão moderada; tarefa de matrícula.');
  p.answerAll(resp);
  p.submit();
  assert.ok(p.q('#result-title'));
  assert.equal(p.q('.score .value').textContent, '67,5');
  assert.equal(p.d.activeElement.id, 'result-title');
  await p.tick(80);
  assert.match(p.d.getElementById('live').textContent, /Pontuação SUS: 67,5 de 100/);
  const rows = p.qa('tbody tr').map((tr) => [...tr.children].map((td) => td.textContent));
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((r) => Number(r[2][0])), resp);
  assert.deepEqual(rows.map((r) => Number(r[4])), [3, 3, 3, 2, 2, 3, 4, 3, 3, 1]);
  assert.match(p.text(), /0,5 pontos abaixo da média de referência de 68/);

  // CSV
  p.click('[data-act="csv"]');
  await p.tick();
  const csvFile = p.saved.find((f) => f.filename.endsWith('.csv'));
  assert.ok(csvFile);
  assert.match(csvFile.filename, /^sus_plataforma-de-ensino_P001_SUS-\d{8}-[A-Z0-9]{4}\.csv$/);
  fs.writeFileSync(path.join(OUT, 'exemplo.csv'), csvFile.data);
  const parsed = C.parseCSV(csvFile.data);
  const rec = Object.fromEntries(parsed[0].map((h, i) => [h, parsed[1][i]]));
  assert.deepEqual(['Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10'].map((q) => Number(rec[q])), resp);
  assert.equal(rec.pontuacao_sus, '67,5');
  assert.equal(rec.sistema_avaliado, 'Plataforma de ensino');
  assert.equal(rec.versao_sistema_avaliado, '3.0-beta');
  assert.equal(rec.situacao, 'concluida');

  // PDF
  p.click('[data-act="pdf"]');
  await p.tick(300);
  const pdfFile = p.saved.find((f) => f.filename.endsWith('.pdf'));
  assert.ok(pdfFile, 'PDF gerado');
  const buf = await new Promise((res, rej) => {
    const fr = new p.w.FileReader();
    fr.onload = () => res(Buffer.from(fr.result));
    fr.onerror = rej;
    fr.readAsArrayBuffer(pdfFile.data);
  });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const pdfPath = path.join(OUT, 'exemplo.pdf');
  fs.writeFileSync(pdfPath, buf);
  const txt = execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString();
  assert.match(txt, /Relatório de Avaliação de Usabilidade — SUS/);
  assert.match(txt, /Plataforma de ensino/);
  assert.match(txt, /3\.0-beta/);
  assert.match(txt, /P001/);
  assert.match(txt, /67,5/);
  assert.match(txt, /27 × 2,5 = 67,5/);
  assert.match(txt, /Brooke, J\. \(1996\)/);
  assert.match(txt, /Lourenço/);
  assert.match(txt, /Sessão moderada/);
  // cada resposta aparece com seu rótulo
  C.ITEMS.forEach((_, i) => assert.ok(txt.includes(`${resp[i]} — ${C.OPTIONS[resp[i] - 1].label.split(" ")[0]}`), 'resposta do item ' + (i + 1)));
  assert.ok(p.stored().exportedAt, 'exportação registrada');
});

test('avaliação concluída é reaberta na página de resultados', () => {
  const st = sharedStorage();
  const a = open(st);
  a.type('f-system', 'S');
  a.answerAll([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]);
  a.submit();
  const b = open(st);
  assert.equal(b.q('.score .value').textContent, '100');
});

test('revisar respostas volta ao formulário e exige novo envio', () => {
  const p = open(sharedStorage());
  p.type('f-system', 'S');
  p.answerAll([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  p.submit();
  p.click('[data-act="review"]');
  assert.ok(p.q('#sus-form'));
  assert.equal(p.stored().status, 'em_andamento');
  p.answer(1, 5);
  p.submit();
  assert.equal(p.q('.score .value').textContent, '55');
});

test('nova avaliação pede confirmação e não sobrescreve sem consentimento', async () => {
  const st = sharedStorage();
  const p = open(st);
  p.type('f-system', 'Antigo');
  p.answer(1, 4);
  p.click('.toolbar [data-act="new"]');
  assert.ok(p.q('#dialog-root [role="dialog"]'), 'diálogo aberto');
  assert.ok(p.dialogButton('Exportar CSV e iniciar'));
  p.click(p.dialogButton('Cancelar'));
  await p.tick();
  assert.equal(p.stored().system, 'Antigo');
  assert.equal(p.d.getElementById('f-system').value, 'Antigo');

  p.click('.toolbar [data-act="new"]');
  p.click(p.dialogButton('Exportar CSV e iniciar'));
  await p.tick(60);
  assert.equal(p.saved.length, 1, 'CSV exportado antes de descartar');
  assert.match(p.saved[0].data, /Antigo/);
  assert.equal(p.stored().system, '');
  assert.equal(p.stored().responses[0], null);

  p.type('f-system', 'Outro');
  p.click('.toolbar [data-act="new"]');
  p.click(p.dialogButton('Descartar e iniciar'));
  await p.tick();
  assert.equal(p.stored().system, '');
});

test('nova avaliação sem dados não pede confirmação', () => {
  const p = open(sharedStorage());
  const code = p.d.getElementById('f-code').value;
  p.click('.toolbar [data-act="new"]');
  assert.equal(p.q('#dialog-root [role="dialog"]'), null);
  assert.notEqual(p.d.getElementById('f-code').value, code);
});

test('limpar dados exige confirmação e remove só os dados da aplicação', async () => {
  const st = sharedStorage();
  st.setItem('outro-app', 'preservar');
  const p = open(st);
  p.type('f-system', 'S');
  p.click('[data-act="clear"]');
  p.click(p.dialogButton('Cancelar'));
  await p.tick();
  assert.ok(st.getItem(C.STORAGE_KEY));
  p.click('[data-act="clear"]');
  p.click(p.dialogButton('Apagar dados'));
  await p.tick();
  assert.equal(st.getItem(C.STORAGE_KEY), null);
  assert.equal(st.getItem('outro-app'), 'preservar');
  assert.equal(p.d.getElementById('f-system').value, '');
});

test('falha de armazenamento é comunicada sem dizer que salvou', () => {
  const p = open(failingStorage());
  assert.equal(p.q('#savebar').dataset.state, 'erro');
  p.answer(1, 3);
  const bar = p.q('#savebar');
  assert.equal(bar.dataset.state, 'erro');
  assert.doesNotMatch(bar.textContent, /Salvo/);
  assert.match(bar.textContent, /exporte o CSV/);
});

test('dado salvo corrompido é informado e uma nova avaliação começa', () => {
  const st = sharedStorage();
  st.setItem(C.STORAGE_KEY, '{quebrado');
  const p = open(st);
  assert.match(p.text(), /Não foi possível recuperar a avaliação salva/);
  assert.ok(p.q('#sus-form'));
});

test('PDF indisponível: mensagem de erro e CSV continua funcionando', async () => {
  const p = open(sharedStorage(), { noPdf: true });
  p.type('f-system', 'S');
  p.answerAll([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  p.submit();
  p.click('[data-act="pdf"]');
  await p.tick();
  assert.match(p.d.getElementById('toast-root').textContent, /gerador de PDF não carregou/);
  p.click('[data-act="csv"]');
  await p.tick();
  assert.equal(p.saved.length, 1);
});

test('nenhuma requisição de rede é feita durante o fluxo', async () => {
  const p = open(sharedStorage());
  p.type('f-system', 'S');
  p.answerAll([2, 4, 2, 4, 2, 4, 2, 4, 2, 4]);
  p.submit();
  p.click('[data-act="csv"]');
  p.click('[data-act="pdf"]');
  await p.tick(300);
  assert.deepEqual(p.network, []);
  assert.doesNotMatch(PAGE, /\bfetch\(|XMLHttpRequest\(|sendBeacon|google-analytics|gtag\(/);
});

test('textos da interface em português (sem rótulos em inglês)', () => {
  const p = open(sharedStorage());
  const labels = p.qa('button, label, h1, h2, legend').map((e) => e.textContent).join(' ');
  assert.doesNotMatch(labels, /\b(Submit|Download|Export|Reset|Clear|Next|Back|Strongly|Agree|Disagree|Score)\b/);
  p.type('f-system', 'S');
  p.answerAll([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  p.submit();
  const res = p.qa('button, h1, h2, th, dt').map((e) => e.textContent).join(' ');
  assert.doesNotMatch(res, /\b(Submit|Download|Export|Reset|Score|Item text|Response)\b/);
});
