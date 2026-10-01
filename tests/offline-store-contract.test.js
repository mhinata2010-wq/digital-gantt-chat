import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
test('offline cache is user scoped and service worker never caches Supabase responses',async()=>{const [store,worker]=await Promise.all([readFile(new URL('offline-store.js',root),'utf8'),readFile(new URL('sw.js',root),'utf8')]);assert.match(store,/key:`\$\{userId\}:\$\{payload\.project\.id\}`/);assert.match(store,/baseVersion:task\.version/);assert.match(store,/clearOfflineUser/);assert.match(worker,/url\.origin!==self\.location\.origin/);assert.doesNotMatch(worker,/supabase\.co/)});
