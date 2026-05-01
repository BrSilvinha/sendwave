const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const src = path.join(__dirname, '..', 'dist', 'SendWave-win32-x64');
const dest = path.join(__dirname, '..', 'dist', 'SendWave.zip');

if (!fs.existsSync(src)) {
  console.error('Primero ejecuta: npm run pack');
  process.exit(1);
}

if (fs.existsSync(dest)) fs.unlinkSync(dest);

console.log('Creando SendWave.zip...');
execSync(
  `powershell -Command "Compress-Archive -Path '${src}' -DestinationPath '${dest}'"`,
  { stdio: 'inherit' }
);
console.log(`\nListo: dist\\SendWave.zip`);
console.log('Comparte ese archivo. El usuario lo descomprime y abre SendWave.exe');
