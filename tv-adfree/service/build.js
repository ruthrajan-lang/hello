// Bundles the service and the ad-block script into service/dist/index.js.
const fs = require('fs');
const path = require('path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'src/index.js')],
  outfile: path.join(__dirname, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node8', // older TVs ship an old Node runtime
  format: 'cjs',
  define: { __ADBLOCK__: JSON.stringify(fs.readFileSync(path.join(__dirname, 'src/adblock.js'), 'utf8')) },
  logLevel: 'warning'
});
console.log('Built service/dist/index.js');
