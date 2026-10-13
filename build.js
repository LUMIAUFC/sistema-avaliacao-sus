// Gera dist/index.html (arquivo único) a partir de src/.
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const html = src('template.html')
  .replace('/*@@CORE@@*/', () => src('sus-core.js'))
  .replace('/*@@PDF@@*/', () => src('sus-pdf.js'))
  .replace('/*@@APP@@*/', () => src('app.js'));
if (/<\/script>/i.test(src('sus-core.js') + src('sus-pdf.js') + src('app.js'))) throw new Error('Código contém </script>');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(1) + ' KB');
