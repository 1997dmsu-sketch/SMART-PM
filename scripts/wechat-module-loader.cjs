const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Unlike Node require, the WeChat runtime only registers JavaScript modules.
function createWechatLoader(root, globals = {}) {
  root = path.resolve(root);
  const cache = new Map();
  const context = vm.createContext({ console, ...globals });
  function load(filename) {
    filename = path.resolve(root, filename);
    if (path.extname(filename) === '.json') throw new Error('WeChat require cannot load JSON: ' + filename);
    if (!filename.endsWith('.js')) filename += '.js';
    const relative = path.relative(root, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Module outside miniprogram root');
    if (cache.has(filename)) return cache.get(filename).exports;
    if (!fs.existsSync(filename)) throw new Error('WeChat JS module missing: ' + filename);
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = name => {
      if (!name.startsWith('.')) throw new Error('Unbundled dependency: ' + name);
      return load(path.resolve(path.dirname(filename), name));
    };
    try {
      const fn = new vm.Script('(function(require,module,exports){\n' + fs.readFileSync(filename, 'utf8') + '\n})', { filename }).runInContext(context);
      fn(localRequire, module, module.exports);
    } catch (error) { cache.delete(filename); throw error; }
    return module.exports;
  }
  return { load };
}
module.exports = { createWechatLoader };
