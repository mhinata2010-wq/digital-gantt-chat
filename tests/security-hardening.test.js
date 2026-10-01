import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('browser shell pins external code and limits executable origins',async()=>{
  const [html,guard,css,worker]=await Promise.all([read('index.html'),read('frame-guard.js'),read('style.css'),read('sw.js')]);
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/object-src 'none'/);
  assert.match(html,/frame-src 'none'/);
  assert.match(html,/@supabase\/supabase-js@2\.57\.4\/dist\/umd\/supabase\.min\.js/);
  assert.match(html,/integrity="sha384-[^"]+"/);
  assert.match(html,/crossorigin="anonymous"/);
  assert.doesNotMatch(html,/@supabase\/supabase-js@2"/);
  assert.match(guard,/window\.top===window\.self/);
  assert.match(css,/html:not\(\.top-level\) body\{display:none!important\}/);
  assert.match(worker,/frame-guard\.js/);
});

test('database hardening fixes weather changes and server-owned actor fields',async()=>{
  const migration=await read('supabase/migrations/202610010004_security_hardening.sql');
  assert.match(migration,/check\(change_type in \('duration_delay','weather_delay'\)\)/);
  assert.match(migration,/new\.created_by=auth\.uid\(\)/);
  assert.match(migration,/new\.created_by=old\.created_by/);
  assert.match(migration,/new\.updated_by=auth\.uid\(\)/);
  assert.match(migration,/layout task must belong to the same active project/);
  assert.match(migration,/drop policy if exists project_files_insert_editor/);
  assert.doesNotMatch(migration,/revoke insert,update,delete on storage\.objects/);
});

test('attachments pass through authenticated server-side content validation',async()=>{
  const [service,fn]=await Promise.all([read('data-service.js'),read('supabase/functions/upload-project-file/index.ts')]);
  assert.match(service,/functions\.invoke\('upload-project-file'/);
  assert.doesNotMatch(service,/storage\.from\('project-files'\)\.upload/);
  assert.doesNotMatch(service,/storage\.from\('project-files'\)\.remove/);
  assert.match(fn,/auth\.getUser\(\)/);
  assert.match(fn,/editor permission required/);
  assert.match(fn,/validSignature/);
  assert.match(fn,/file content does not match its type/);
  assert.match(fn,/active PDF content is not allowed/);
  assert.match(fn,/SUPABASE_SERVICE_ROLE_KEY/);
});

test('invitation mail binds exact site invitation and owner',async()=>{
  const fn=await read('supabase/functions/send-invitation/index.ts');
  assert.match(fn,/candidate\.origin!==allowed\.origin/);
  assert.match(fn,/candidate\.pathname!==allowed\.pathname/);
  assert.match(fn,/sha256\(token\)!==invitation\.token_hash/);
  assert.match(fn,/\.eq\('role','owner'\)/);
  assert.match(fn,/invitation\.accepted_at\|\|invitation\.revoked_at/);
  assert.doesNotMatch(fn,/inviteUrl\.startsWith\(site\)/);
  assert.doesNotMatch(fn,/Access-Control-Allow-Origin':'\*'/);
});
