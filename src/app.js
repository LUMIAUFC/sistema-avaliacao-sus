/*
 * app.js — Interface do Sistema de Avaliação SUS.
 * Depende de SUSCore (sus-core.js), SUSPdf (sus-pdf.js) e, para o PDF, de window.jspdf.
 */
(function () {
  'use strict';
  var C = window.SUSCore;
  var $app = document.getElementById('app');
  var $live = document.getElementById('live');
  var $dialogRoot = document.getElementById('dialog-root');
  var $toastRoot = document.getElementById('toast-root');

  var state = {
    ev: null,
    store: null,
    storageOk: true,
    lastSavedAt: null,
    recovered: false,
    loadError: null,
    attempted: false,
    errors: null,
    view: 'form'
  };

  /* ---------- utilidades ---------- */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function announce(msg) {
    $live.textContent = '';
    setTimeout(function () { $live.textContent = msg; }, 50);
  }
  var toastTimer = null;
  function toast(msg, kind) {
    $toastRoot.innerHTML = '<div class="toast" role="status" data-kind="' + (kind || 'ok') + '">' + esc(msg) + '</div>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toastRoot.innerHTML = ''; }, 4500);
  }
  function hhmm(d) { var x = d || new Date(); return ('0' + x.getHours()).slice(-2) + ':' + ('0' + x.getMinutes()).slice(-2); }
  function safeLocalStorage() { try { return window.localStorage; } catch (e) { return null; } }
  function hasData(ev) {
    return !!(ev.system.trim() || ev.participant.trim() || ev.systemVersion.trim() || ev.notes.trim() || C.answeredCount(ev.responses));
  }
  function exportedSinceLastChange(ev) {
    return !!ev.exportedAt && ev.exportedAt >= ev.updatedAt;
  }

  /* ---------- persistência ---------- */

  function persist(touch) {
    if (touch !== false) state.ev.updatedAt = new Date().toISOString();
    var res = state.store.save(state.ev);
    state.storageOk = res.ok;
    if (res.ok) state.lastSavedAt = new Date();
    renderSaveBar();
    return res.ok;
  }

  function saveBarHtml() {
    if (!state.storageOk) {
      return '<p class="savebar" data-state="erro" id="savebar" role="alert"><span class="dot" aria-hidden="true"></span>' +
        'Não foi possível salvar neste navegador (armazenamento bloqueado, cheio ou em navegação privada). ' +
        'As respostas ficam só nesta aba: exporte o CSV para não perdê-las.</p>';
    }
    var when = state.lastSavedAt ? 'Salvo neste navegador às ' + hhmm(state.lastSavedAt) + '.' : 'Salvamento automático neste navegador.';
    return '<p class="savebar" data-state="ok" id="savebar"><span class="dot" aria-hidden="true"></span>' + when +
      ' Os dados não são enviados pela internet.</p>';
  }
  function renderSaveBar() {
    var el = document.getElementById('savebar');
    if (el) el.outerHTML = saveBarHtml();
  }

  /* ---------- diálogo de confirmação ---------- */

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var btns = opts.buttons.map(function (b, i) {
        return '<button type="button" data-i="' + i + '" class="' + (b.cls || '') + '">' + esc(b.label) + '</button>';
      }).join('');
      $dialogRoot.innerHTML =
        '<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d">' +
        '<h2 id="dlg-t">' + esc(opts.title) + '</h2><p id="dlg-d">' + esc(opts.body) + '</p>' +
        '<div class="actions">' + btns + '</div></div></div>';
      var dlg = $dialogRoot.querySelector('.dialog');
      var buttons = Array.prototype.slice.call(dlg.querySelectorAll('button'));
      function close(val) {
        $dialogRoot.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
        if (prevFocus && prevFocus.focus && document.body.contains(prevFocus)) prevFocus.focus();
        resolve(val);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        if (e.key === 'Tab') {
          var i = buttons.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); buttons[buttons.length - 1].focus(); }
          else if (!e.shiftKey && i === buttons.length - 1) { e.preventDefault(); buttons[0].focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      buttons.forEach(function (b) {
        b.addEventListener('click', function () { close(opts.buttons[+b.dataset.i].value); });
      });
      var def = buttons[opts.focus || buttons.length - 1];
      (def || buttons[0]).focus();
    });
  }

  /* ---------- downloads ---------- */

  var dlPromise = null;
  function getDownloads() {
    if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null);
    if (!dlPromise) dlPromise = Promise.resolve(window.claude.use('downloads')).catch(function () { return null; });
    return dlPromise;
  }
  function saveFile(filename, data, mime) {
    if (typeof window.__SUS_SAVE_HOOK__ === 'function') return Promise.resolve(window.__SUS_SAVE_HOOK__(filename, data, mime));
    return getDownloads().then(function (dl) {
      if (dl) {
        return dl.save({ filename: filename, data: data }).then(function () { return 'ok'; }, function (e) {
          var code = e && e.code;
          if (code === 'declined') return 'declined';
          if (code === 'rate_limited') return 'busy';
          if (code && code !== 'unavailable' && code !== 'not_granted' && code !== 'capability_disabled' && code !== 'capability_removed') throw e;
          return fallbackDownload(filename, data, mime);
        });
      }
      return fallbackDownload(filename, data, mime);
    });
  }
  function fallbackDownload(filename, data, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    return 'ok';
  }
  function afterSave(result, what) {
    if (result === 'ok') {
      state.ev.exportedAt = new Date().toISOString();
      persist(false);
      toast(what + ' pronto para download.');
      announce(what + ' gerado.');
      return true;
    }
    if (result === 'declined') { toast('Download cancelado.'); return false; }
    if (result === 'busy') { toast('Já existe um download aguardando confirmação.'); return false; }
    return false;
  }

  function exportCSV(btn) {
    setBusy(btn, true);
    var csv = C.buildCSV(state.ev);
    return saveFile(C.exportFilename(state.ev, 'csv'), csv, 'text/csv;charset=utf-8')
      .then(function (r) { return afterSave(r, 'CSV'); })
      .catch(function () { toast('Não foi possível gerar o CSV. Tente novamente.', 'erro'); return false; })
      .then(function (ok) { setBusy(btn, false); return ok; });
  }

  function exportPDF(btn) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      toast('O gerador de PDF não carregou (verifique a conexão e recarregue a página). O CSV continua disponível.', 'erro');
      return Promise.resolve(false);
    }
    setBusy(btn, true);
    return new Promise(function (res) { setTimeout(res, 20); }).then(function () {
      var report = C.buildReport(state.ev);
      var doc = window.SUSPdf.renderPDF(window.jspdf.jsPDF, report);
      var blob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
      return saveFile(C.exportFilename(state.ev, 'pdf'), blob, 'application/pdf');
    }).then(function (r) { return afterSave(r, 'PDF'); })
      .catch(function () { toast('Não foi possível gerar o PDF. Tente novamente.', 'erro'); return false; })
      .then(function (ok) { setBusy(btn, false); return ok; });
  }

  function setBusy(btn, on) {
    if (!btn) return;
    if (on) { btn.setAttribute('aria-busy', 'true'); btn.dataset.label = btn.textContent; btn.textContent = 'Gerando…'; btn.disabled = true; }
    else { btn.removeAttribute('aria-busy'); btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  /* ---------- ações de ciclo de vida ---------- */

  function startNew() {
    state.ev = C.createEvaluation();
    state.recovered = false;
    state.loadError = null;
    state.attempted = false;
    state.errors = null;
    persist();
    renderForm();
    var f = document.getElementById('f-system');
    if (f) f.focus();
    announce('Nova avaliação iniciada.');
  }

  function requestNew(btn) {
    if (!hasData(state.ev)) { startNew(); return Promise.resolve(); }
    var exported = exportedSinceLastChange(state.ev);
    return confirmDialog({
      title: 'Iniciar uma nova avaliação?',
      body: exported
        ? 'A avaliação atual já foi exportada. Ao continuar, ela será removida deste navegador.'
        : 'A avaliação atual ainda não foi exportada desde a última alteração. Ao continuar sem exportar, as respostas serão perdidas.',
      buttons: exported
        ? [{ label: 'Cancelar', value: null }, { label: 'Iniciar nova avaliação', value: 'discard', cls: 'primary' }]
        : [{ label: 'Cancelar', value: null }, { label: 'Descartar e iniciar', value: 'discard', cls: 'danger' }, { label: 'Exportar CSV e iniciar', value: 'export', cls: 'primary' }]
    }).then(function (choice) {
      if (choice === 'discard') startNew();
      else if (choice === 'export') return exportCSV(btn).then(function (ok) { if (ok) startNew(); });
    });
  }

  function requestClear() {
    return confirmDialog({
      title: 'Apagar os dados locais?',
      body: 'A avaliação salva neste navegador será apagada definitivamente. Dados de outros sites e arquivos já exportados não são afetados.',
      buttons: [{ label: 'Cancelar', value: null }, { label: 'Apagar dados', value: 'clear', cls: 'danger solid' }],
      focus: 0
    }).then(function (choice) {
      if (choice !== 'clear') return;
      var r = state.store.clear();
      state.ev = C.createEvaluation();
      state.recovered = false; state.loadError = null; state.attempted = false; state.errors = null;
      state.lastSavedAt = null;
      renderForm();
      if (r.ok) { toast('Dados locais apagados.'); announce('Dados locais apagados.'); }
      else toast('Não foi possível apagar os dados deste navegador.', 'erro');
    });
  }

  function submit() {
    state.attempted = true;
    var idErr = C.validateIdentification(state.ev);
    var check = C.validateResponses(state.ev.responses);
    if (Object.keys(idErr).length || !check.valid) {
      state.errors = { id: idErr, missing: check.missing, invalid: check.invalid };
      renderForm();
      var sum = document.getElementById('error-summary');
      if (sum) { sum.focus(); sum.scrollIntoView({ block: 'start' }); }
      return false;
    }
    state.errors = null;
    state.ev.result = C.calculateSUS(state.ev.responses);
    state.ev.status = 'concluida';
    state.ev.submittedAt = new Date().toISOString();
    persist();
    renderResult();
    var h = document.getElementById('result-title');
    if (h) h.focus();
    announce('Questionário concluído. Pontuação SUS: ' + C.formatNumber(state.ev.result.score) + ' de 100.');
    return true;
  }

  function review() {
    state.ev.status = 'em_andamento';
    state.ev.submittedAt = null;
    state.ev.result = null;
    persist();
    renderForm();
    announce('Revisão das respostas. Envie novamente para recalcular a pontuação.');
    var first = document.querySelector('fieldset.item input:checked') || document.getElementById('f-system');
    if (first) first.focus();
  }

  /* ---------- renderização: formulário ---------- */

  function fieldHtml(id, key, label, hint, opts) {
    opts = opts || {};
    var err = state.errors && state.errors.id && state.errors.id[key];
    var describedby = [hint ? id + '-h' : '', err ? id + '-e' : ''].filter(Boolean).join(' ');
    var attrs = 'id="' + id + '" name="' + key + '" data-key="' + key + '" maxlength="' + (C.LIMITS[key] || 200) + '"' +
      (opts.required ? ' required aria-required="true"' : '') + (err ? ' aria-invalid="true"' : '') +
      (describedby ? ' aria-describedby="' + describedby + '"' : '') + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      (opts.autocomplete ? ' autocomplete="' + opts.autocomplete + '"' : '');
    var control = opts.textarea
      ? '<textarea ' + attrs + '>' + esc(state.ev[key]) + '</textarea>'
      : '<input type="text" ' + attrs + ' value="' + esc(state.ev[key]) + '">';
    return '<div class="field' + (opts.full ? ' full' : '') + (err ? ' has-error' : '') + '">' +
      '<label for="' + id + '">' + esc(label) + (opts.required ? ' <span aria-hidden="true">*</span>' : ' <span class="muted small">(opcional)</span>') + '</label>' +
      control +
      (hint ? '<span class="hint" id="' + id + '-h">' + esc(hint) + '</span>' : '') +
      (err ? '<span class="err" id="' + id + '-e">Erro: ' + esc(err) + '</span>' : '') +
      '</div>';
  }

  function itemHtml(text, i) {
    var n = i + 1;
    var missing = state.errors && (state.errors.missing.indexOf(n) >= 0 || state.errors.invalid.indexOf(n) >= 0);
    var opts = C.OPTIONS.map(function (o) {
      var checked = state.ev.responses[i] === o.value;
      return '<label><input type="radio" name="q' + n + '" value="' + o.value + '"' + (checked ? ' checked' : '') +
        ' data-item="' + i + '"><span class="v" aria-hidden="true">' + o.value + '</span><span class="t">' + esc(o.label) +
        '</span><span class="chk sr-only">(selecionado)</span></label>';
    }).join('');
    return '<li><fieldset class="item' + (missing ? ' missing' : '') + '" id="item-' + n + '"' +
      (missing ? ' aria-describedby="item-' + n + '-e"' : '') + '>' +
      '<legend><span class="num">' + (n < 10 ? '0' + n : n) + '</span><span>' + esc(text) + '</span></legend>' +
      (missing ? '<p class="item-err" id="item-' + n + '-e"><span aria-hidden="true">!</span> Erro: escolha uma opção para este item.</p>' : '') +
      '<div class="likert">' + opts + '</div></fieldset></li>';
  }

  function errorSummaryHtml() {
    if (!state.errors) return '';
    var li = [];
    Object.keys(state.errors.id).forEach(function (k) {
      var id = { system: 'f-system', participant: 'f-participant' }[k] || 'f-' + k;
      li.push('<li><a href="#' + id + '" data-focus="' + id + '">' + esc(state.errors.id[k]) + '</a></li>');
    });
    state.errors.missing.concat(state.errors.invalid).sort(function (a, b) { return a - b; }).forEach(function (n) {
      li.push('<li><a href="#item-' + n + '" data-focus="q' + n + '">Item ' + n + ' sem resposta</a></li>');
    });
    return '<div class="notice error" id="error-summary" tabindex="-1" role="alert">' +
      '<h2>A pontuação ainda não pode ser calculada</h2>' +
      '<p class="small">Corrija ' + (li.length === 1 ? 'o ponto abaixo' : 'os ' + li.length + ' pontos abaixo') + '. Nenhuma resposta é preenchida automaticamente.</p>' +
      '<ul>' + li.join('') + '</ul></div>';
  }

  function recoveredHtml() {
    if (state.loadError) {
      return '<div class="notice error" role="alert"><h2>Não foi possível recuperar a avaliação salva</h2>' +
        '<p class="small">' + (state.loadError === 'corrompido'
          ? 'Os dados guardados neste navegador estão ilegíveis. Uma nova avaliação foi iniciada.'
          : 'O armazenamento deste navegador não está acessível. Você pode preencher normalmente, mas exporte o CSV antes de fechar a página.') + '</p></div>';
    }
    if (!state.recovered) return '';
    return '<div class="notice info" role="status"><h2>Avaliação recuperada deste navegador</h2>' +
      '<p class="small">Iniciada em ' + esc(C.formatDateTime(state.ev.createdAt)) + ', última alteração em ' + esc(C.formatDateTime(state.ev.updatedAt)) +
      '. ' + C.answeredCount(state.ev.responses) + ' de 10 itens já respondidos. Continue de onde parou.</p>' +
      '<div class="actions"><button type="button" class="link" data-act="new">Iniciar outra avaliação</button></div></div>';
  }

  function progressHtml() {
    var n = C.answeredCount(state.ev.responses);
    return '<div class="progress" id="progress"><div class="progress-inner">' +
      '<p class="progress-text" id="progress-text"><strong>' + n + '</strong> de 10 itens respondidos</p>' +
      '<div class="meter" role="progressbar" aria-labelledby="progress-text" aria-valuemin="0" aria-valuemax="10" aria-valuenow="' + n + '"><span style="width:' + (n * 10) + '%"></span></div>' +
      '</div></div>';
  }
  function updateProgress() {
    var n = C.answeredCount(state.ev.responses);
    var p = document.getElementById('progress-text');
    if (!p) return;
    p.innerHTML = '<strong>' + n + '</strong> de 10 itens respondidos';
    var m = document.querySelector('#progress .meter');
    m.setAttribute('aria-valuenow', n);
    m.firstChild.style.width = (n * 10) + '%';
  }

  function renderForm() {
    state.view = 'form';
    var ev = state.ev;
    $app.innerHTML =
      '<header class="masthead">' +
        '<p class="eyebrow">Avaliação de usabilidade</p>' +
        '<h1>Escala de Usabilidade do Sistema (SUS)</h1>' +
        '<p class="lede">Questionário de usabilidade percebida com 10 afirmações. Preencha a identificação e responda a todos os itens para calcular a pontuação.</p>' +
        saveBarHtml() +
      '</header>' +
      progressHtml() +
      '<main>' +
      recoveredHtml() +
      errorSummaryHtml() +
      '<form id="sus-form" novalidate>' +
        '<section class="block" aria-labelledby="h-id">' +
          '<div class="block-head"><h2 id="h-id">Identificação da avaliação</h2><span class="muted small">* obrigatório</span></div>' +
          '<div class="fields">' +
            fieldHtml('f-system', 'system', 'Sistema avaliado', 'Nome ou código. Ex.: Plataforma de ensino', { required: true, full: true, autocomplete: 'off' }) +
            fieldHtml('f-systemVersion', 'systemVersion', 'Versão do sistema avaliado', 'Ex.: 2.1 ou protótipo de março', { autocomplete: 'off' }) +
            fieldHtml('f-participant', 'participant', 'Código do participante', 'Use um código, nunca o nome. Ex.: P001', { autocomplete: 'off' }) +
            '<div class="field"><label for="f-code">Código da avaliação</label><input id="f-code" type="text" readonly value="' + esc(ev.code) + '"><span class="hint">Gerado automaticamente</span></div>' +
            '<div class="field"><label for="f-date">Data da avaliação</label><input id="f-date" type="text" readonly value="' + esc(C.formatDate(ev.createdAt)) + '"><span class="hint">Preenchida automaticamente</span></div>' +
          '</div>' +
        '</section>' +
        '<section class="block" aria-labelledby="h-q">' +
          '<div class="block-head"><h2 id="h-q">Questionário</h2><span class="muted small">10 itens</span></div>' +
          '<p class="instructions">Para cada afirmação, marque a opção que melhor expressa a sua experiência com o sistema avaliado. Responda a todos os itens, mesmo sem certeza; nesse caso, escolha a opção do meio.</p>' +
          '<ol class="items">' + C.ITEMS.map(itemHtml).join('') + '</ol>' +
        '</section>' +
        '<section class="block" aria-labelledby="h-notes">' +
          '<div class="block-head"><h2 id="h-notes">Observações do avaliador</h2><span class="muted small">Fora do questionário SUS</span></div>' +
          '<div class="fields">' + fieldHtml('f-notes', 'notes', 'Observações', 'Contexto da sessão, tarefas realizadas, ocorrências. Não inclua dados pessoais.', { textarea: true, full: true }) + '</div>' +
        '</section>' +
        '<div class="toolbar">' +
          '<button type="submit" class="primary" id="btn-submit">Calcular pontuação SUS</button>' +
          '<div class="actions">' +
            '<button type="button" data-act="draft">Exportar rascunho (CSV)</button>' +
            '<button type="button" data-act="new">Nova avaliação</button>' +
            '<button type="button" class="danger" data-act="clear">Limpar dados locais</button>' +
          '</div>' +
        '</div>' +
      '</form>' +
      privacyHtml() +
      '</main>';
    bindForm();
  }

  function privacyHtml() {
    return '<details class="privacy"><summary>Como os dados são tratados</summary><ul>' +
      '<li>Tudo é processado neste navegador. Nenhuma resposta é enviada a servidores, e não há rastreamento ou análise de terceiros.</li>' +
      '<li>A avaliação é salva automaticamente no armazenamento local deste navegador e deste perfil. Ela não aparece em outros dispositivos, navegadores ou perfis.</li>' +
      '<li>O armazenamento local é temporário e não substitui uma cópia de segurança: os dados se perdem ao limpar os dados do navegador, em navegação privada ou em falhas de armazenamento. Exporte o CSV ou o PDF ao final de cada sessão.</li>' +
      '<li>Os dados permanecem até você iniciar uma nova avaliação ou usar “Limpar dados locais”.</li>' +
      '<li>Itens em português: versão brasileira de Lourenço, Carmona e Lopes (2022), transcrita da Tabela 1 do artigo. Confirme a adequação ao seu público antes de usar em pesquisa.</li>' +
      '</ul></details>';
  }

  function bindForm() {
    var form = document.getElementById('sus-form');
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    form.addEventListener('change', function (e) {
      var t = e.target;
      if (t.type === 'radio' && t.dataset.item !== undefined) {
        var i = +t.dataset.item;
        var v = parseInt(t.value, 10);
        if (!C.isValidResponse(v)) return;
        state.ev.responses[i] = v;
        persist();
        updateProgress();
        if (state.errors) {
          var fs = document.getElementById('item-' + (i + 1));
          fs.classList.remove('missing');
          var er = document.getElementById('item-' + (i + 1) + '-e');
          if (er) er.remove();
          fs.removeAttribute('aria-describedby');
        }
      }
    });
    form.addEventListener('input', function (e) {
      var key = e.target.dataset.key;
      if (!key) return;
      state.ev[key] = C.sanitizeText(e.target.value, C.LIMITS[key]);
      persist();
    });
    $app.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.dataset.act;
        if (act === 'new') requestNew(b);
        else if (act === 'clear') requestClear();
        else if (act === 'draft') exportCSV(b);
      });
    });
    $app.querySelectorAll('[data-focus]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var id = a.dataset.focus;
        var el = document.getElementById(id) || document.querySelector('input[name="' + id + '"]');
        if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
      });
    });
  }

  /* ---------- renderização: resultado ---------- */

  function renderResult() {
    state.view = 'result';
    var ev = state.ev;
    var rep = C.buildReport(ev);
    var pct = rep.score;
    var ref = rep.interpretation.benchmark;
    var rows = rep.items.map(function (it) {
      return '<tr><td class="n">' + it.number + '</td><td>' + esc(it.text) + '</td><td>' + it.response + ' — ' + esc(it.responseLabel) +
        '</td><td class="muted rule">' + esc(it.rule) + '</td><td class="n">' + it.contribution + '</td></tr>';
    }).join('');
    $app.innerHTML =
      '<header class="result-head">' +
        '<p class="eyebrow">Resultado da avaliação · concluída</p>' +
        '<h1 id="result-title" tabindex="-1">' + esc(ev.system.trim()) + '</h1>' +
        saveBarHtml() +
      '</header>' +
      '<main>' +
        '<dl class="meta">' + rep.identification.map(function (p) {
          return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
        }).join('') + '</dl>' +
        '<section class="score-panel" aria-labelledby="h-score">' +
          '<h2 id="h-score" class="sr-only">Pontuação SUS</h2>' +
          '<p class="score"><span class="value">' + esc(rep.scoreText) + '</span><span class="of">/ 100 · pontuação SUS</span></p>' +
          '<div class="scale" role="img" aria-label="Escala de 0 a 100: pontuação ' + esc(rep.scoreText) + ', média de referência 68">' +
            '<div class="track"><div class="fill" style="width:' + pct + '%"></div></div>' +
            '<div class="ref" style="left:' + ref + '%"></div>' +
            '<span class="tick start" style="left:0">0</span>' +
            '<span class="tick" style="left:50%">50</span>' +
            '<span class="tick end" style="left:100%">100</span>' +
            '<span class="tick reflabel" style="left:' + ref + '%">┆ média de referência 68</span>' +
          '</div>' +
          '<div class="interp"><h2>Interpretação</h2><p>' + esc(rep.interpretation.text) + '</p></div>' +
          '<ul class="caveats">' + rep.caveats.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' +
        '</section>' +
        (rep.notes ? '<section class="block"><div class="block-head"><h2>Observações do avaliador</h2></div><p style="white-space:pre-wrap">' + esc(rep.notes) + '</p></section>' : '') +
        '<section class="block" aria-labelledby="h-table">' +
          '<div class="block-head"><h2 id="h-table">Respostas e contribuições</h2></div>' +
          '<div class="table-wrap" tabindex="0" role="region" aria-labelledby="h-table"><table>' +
            '<caption>Contribuição ajustada de 0 a 4 por item, para transparência do cálculo. Não é uma medida independente de usabilidade.</caption>' +
            '<thead><tr><th class="n" scope="col">Item</th><th scope="col">Afirmação</th><th scope="col">Resposta</th><th scope="col">Regra</th><th class="n" scope="col">Contrib.</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
            '<tfoot><tr><td colspan="4">Soma das contribuições × 2,5</td><td class="n">' + rep.sum + ' × 2,5 = ' + esc(rep.scoreText) + '</td></tr></tfoot>' +
          '</table></div>' +
        '</section>' +
        '<section class="block" aria-labelledby="h-formula">' +
          '<div class="block-head"><h2 id="h-formula">Fórmula aplicada</h2><span class="muted small">' + esc(rep.algorithmVersion) + '</span></div>' +
          '<p class="formula">' + esc(rep.formula) + '</p>' +
          '<p class="muted small">Itens ímpares (1, 3, 5, 7, 9) são afirmações positivas e pares (2, 4, 6, 8, 10) negativas, conforme Brooke (1996). O resultado é sempre múltiplo de 2,5 e não é arredondado.</p>' +
        '</section>' +
        '<section class="block" aria-labelledby="h-ref">' +
          '<div class="block-head"><h2 id="h-ref">Referências</h2></div>' +
          '<ol class="refs">' + rep.references.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol>' +
        '</section>' +
        '<div class="toolbar">' +
          '<div class="actions">' +
            '<button type="button" class="primary" data-act="pdf">Baixar PDF</button>' +
            '<button type="button" data-act="csv">Exportar CSV</button>' +
          '</div>' +
          '<div class="actions">' +
            '<button type="button" data-act="review">Revisar respostas</button>' +
            '<button type="button" data-act="new">Nova avaliação</button>' +
            '<button type="button" class="danger" data-act="clear">Limpar dados locais</button>' +
          '</div>' +
        '</div>' +
        privacyHtml() +
      '</main>';
    $app.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.dataset.act;
        if (act === 'pdf') exportPDF(b);
        else if (act === 'csv') exportCSV(b);
        else if (act === 'review') review();
        else if (act === 'new') requestNew(b);
        else if (act === 'clear') requestClear();
      });
    });
  }

  /* ---------- inicialização ---------- */

  function init() {
    state.store = C.createStore(safeLocalStorage());
    state.storageOk = state.store.available();
    var loaded = state.store.load();
    if (loaded.ok && loaded.evaluation) {
      state.ev = loaded.evaluation;
      state.recovered = hasData(state.ev);
    } else {
      state.ev = C.createEvaluation();
      if (!loaded.ok) state.loadError = loaded.error;
    }
    if (state.ev.status === 'concluida') renderResult();
    else renderForm();
  }

  window.SUSApp = {
    state: state, submit: submit, review: review, startNew: startNew, requestNew: requestNew,
    requestClear: requestClear, exportCSV: exportCSV, exportPDF: exportPDF
  };

  init();
})();
