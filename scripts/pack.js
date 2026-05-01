const { packager } = require('@electron/packager');
const path = require('path');

async function main() {
  console.log('Empaquetando SendWave...');

  const appPaths = await packager({
    dir: path.join(__dirname, '..'),
    name: 'SendWave',
    platform: 'win32',
    arch: 'x64',
    out: path.join(__dirname, '..', 'dist'),
    overwrite: true,
    appVersion: '1.0.0',
    ignore: [
      /^\/node_modules/,
      /^\/dist/,
      /^\/\.git/,
      /^\/scripts/,
      /^\/assets/,
      /^\/frontend\/(?!out)/,
      /^\/backend\/\.auth_state/,
    ],
  });

  console.log(`\nListo: ${appPaths[0]}`);
  console.log('Ejecuta: dist\\SendWave-win32-x64\\SendWave.exe');
}

main().catch((err) => {
  console.error('Error al empaquetar:', err.message);
  process.exit(1);
});
