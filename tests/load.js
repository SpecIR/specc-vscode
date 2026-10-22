const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

exports.load = (file, mocks = {}, globals) => {
  const code = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', file)], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['vscode'],
  }).outputFiles[0].text;
  const mod = { exports: {} };
  const wrapper = `(function(require, module, exports) { ${code}\n})`;
  (globals ? vm.runInNewContext(wrapper, globals) : vm.runInThisContext(wrapper))(
    name => name in mocks ? mocks[name] : require(name), mod, mod.exports);
  return mod.exports;
};
