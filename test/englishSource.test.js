import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const sourceRoot = path.join(root, 'src');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('all JavaScript source and package metadata are English-only', () => {
  const files = [...walk(sourceRoot), path.join(root, 'package.json')];
  const vietnamese = /[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰự]/u;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, vietnamese, `Vietnamese text remains in ${path.relative(root, file)}`);
  }
});

test('source contains no deprecated ephemeral response option or ready listener', () => {
  for (const file of walk(sourceRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\bephemeral\s*:/u, `Deprecated ephemeral option remains in ${path.relative(root, file)}`);
    assert.doesNotMatch(text, /\.once\(['"]ready['"]|\.on\(['"]ready['"]/u, `Deprecated ready listener remains in ${path.relative(root, file)}`);
  }
});
