// Gera dist/index.html: documento HTML completo e autossuficiente, a partir de src/.
// Com --artifact, gera também artifact/index.html (só o conteúdo do <body>),
// formato usado para publicar como artifact no claude.ai, que acrescenta o cabeçalho.
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

const code = src('sus-core.js') + src('sus-pdf.js') + src('app.js');
if (/<\/script>/i.test(code)) throw new Error('Código contém </script>');

const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'src', 'assets', 'logo-lumia.png')).toString('base64');
const filled = src('template.html')
  .replace('@@LOGO@@', () => logo)
  .replace('/*@@CORE@@*/', () => src('sus-core.js'))
  .replace('/*@@PDF@@*/', () => src('sus-pdf.js'))
  .replace('/*@@APP@@*/', () => src('app.js'));

// O template começa pelos elementos de cabeçalho (título, metadados, fontes, estilos).
const cut = filled.indexOf('</style>') + '</style>'.length;
const head = filled.slice(0, cut).trim();
const body = filled.slice(cut).trim();

const page = '<!doctype html>\n<html lang="pt-BR">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  head + '\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), page);
console.log('dist/index.html', (page.length / 1024).toFixed(1) + ' KB');

if (process.argv.includes('--artifact')) {
  fs.mkdirSync(path.join(__dirname, 'artifact'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'artifact', 'index.html'), filled);
  console.log('artifact/index.html', (filled.length / 1024).toFixed(1) + ' KB');
}
