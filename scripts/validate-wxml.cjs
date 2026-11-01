const assert = require('node:assert/strict');
const vm = require('node:vm');

// Catch known compiler incompatibilities. This is not a replacement for wcc.
function validateWxml(source, filename = 'template') {
  const text = source.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of text.matchAll(/{{([\s\S]*?)}}/g)) {
    assert(!/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i.test(match[1]), `${filename}: HTML entity inside WXML expression; use the literal operator`);
    try { new vm.Script(`(${match[1]})`); }
    catch (err) { throw new Error(`${filename}: invalid expression ${match[0]}: ${err.message}`); }
  }
  const stack = [{ tag: '#root', branch: false }];
  for (const match of text.matchAll(/<(\/?)([\w:-]+)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
    if (match[1]) {
      assert(stack.length > 1, `${filename}: unexpected closing tag ${match[2]}`);
      assert.equal(stack.pop().tag, match[2], `${filename}: unbalanced tags`);
      continue;
    }
    // Read directive names only outside quoted attribute values.
    const directives = new Set();
    const attrs = match[3];
    for (const attr of attrs.matchAll(/([^\s=/'"]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/g)) directives.add(attr[1]);
    const hasIf = directives.has('wx:if');
    const hasElif = directives.has('wx:elif');
    const hasElse = directives.has('wx:else');
    const hasFor = directives.has('wx:for');
    assert(Number(hasIf) + Number(hasElif) + Number(hasElse) <= 1, `${filename}: conflicting conditional directives`);
    assert(!(hasFor && (hasElse || hasElif)), `${filename}: wrap wx:for inside a separate wx:else/wx:elif block`);
    const parent = stack[stack.length - 1];
    if (hasElse || hasElif) assert(parent.branch, `${filename}: wx:else/wx:elif has no preceding sibling wx:if`);
    parent.branch = (hasIf || hasElif) && !hasFor;
    if (!attrs.trimEnd().endsWith('/')) stack.push({ tag: match[2], branch: false });
  }
  assert.equal(stack.length, 1, `${filename}: unclosed tags`);
}
module.exports = { validateWxml };
