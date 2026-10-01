import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDelimited,buildImportCandidates,toImportRows} from '../schedule-import.js';

test('読取結果TSVを候補へ変換し、番号の先行工程を記号へ解決する',()=>{
  const matrix=parseDelimited('工種\t作業名\t開始日\t終了日\t先行\tx0\tx1\ty\n仮設\t仮囲い\t2026/11/2\t2026/11/4\t\t10\t40\t20\n土工\t根切り\t2026/11/5\t2026/11/8\t1\t45\t90\t40');
  const {candidates}=buildImportCandidates(matrix);
  assert.equal(candidates.length,2);assert.equal(candidates[0].duration,3);assert.deepEqual(candidates[1].predecessorCodes,['A']);assert.equal(toImportRows(candidates).length,2);
});

test('Python読取座標が棟・階に混入した旧形式を警告する',()=>{
  const matrix=parseDelimited('工種\t作業名\t開始日\t終了日\t先行\t棟・階\nx\t配筋\t2026-11-01\t2026-11-03\t\t353.3');
  const {candidates}=buildImportCandidates(matrix);
  assert.equal(candidates[0].accepted,false);assert.equal(candidates[0].building,'');assert.match(candidates[0].issues.join(''),/読取座標/);
});

test('既存記号の重複と不明な前工程を確定対象から外す',()=>{
  const matrix=[['記号','作業名','所要日数','前工程'],['A','山留め',3,'Z']];
  const {candidates}=buildImportCandidates(matrix,{existingTasks:[{code:'A'}]});
  assert.equal(candidates[0].accepted,false);assert.match(candidates[0].issues.join(' '),/重複/);assert.match(candidates[0].issues.join(' '),/見つかりません/);
});

test('建築士用の数量・歩掛・班数・金額を保持し、未入力日数を算出する',()=>{
  const matrix=[['記号','工種','作業名','数量','単位','1日量','班数','人/班','日数','先行','金額(千円)','棟','階'],['A','躯体','壁配筋',120,'㎡',20,2,4,'','',3500,'A棟','2階']];
  const {candidates}=buildImportCandidates(matrix),rows=toImportRows(candidates);
  assert.equal(candidates[0].duration,3);assert.equal(rows[0].quantity,'120');assert.equal(rows[0].daily_output,'20');assert.equal(rows[0].crew_count,'2');assert.equal(rows[0].people_per_crew,'4');assert.equal(rows[0].cost_thousands,'3500');assert.equal(rows[0].building,'A棟');assert.equal(rows[0].floor,'2階');
});
