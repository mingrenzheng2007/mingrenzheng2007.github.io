import test from 'node:test';
import assert from 'node:assert/strict';
import {SITES} from '../great-wall-data.js';
import {distanceMeters,dateKey,imageUrl,visitStats,mergeRecords,creationPrompt,generationSize,escapeHtml} from '../great-wall-core.js';
import {buildScoredSites} from '../great-wall-scores.js';

test('HTTPS image migration upgrades legacy gateway URLs but rejects unsafe schemes',()=>{
 assert.equal(imageUrl('http://47.103.59.118/ai/gallery-images/test.jpg'),'https://47.103.59.118/ai/gallery-images/test.jpg');
 assert.equal(imageUrl('http://yimaweilai.top/ai/site-covers/a.jpg'),'https://47.103.59.118/ai/site-covers/a.jpg');
 assert.equal(imageUrl('javascript:alert(1)'),'');
 assert.equal(escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
});
test('missing location stays distinct from an exact zero-distance arrival',()=>{
 assert.equal(distanceMeters(null,SITES[0]),null);
 assert.equal(distanceMeters(SITES[0],SITES[0]),0);
 assert.ok(distanceMeters(SITES[0],SITES[1])>8000);
});
test('local and synced records deduplicate by client ID and count distinct patrol sites',()=>{
 const day='2026-10-03';
 const local=[{id:'a',siteId:SITES[0].id,kind:'patrol',date:day},{id:'b',siteId:SITES[0].id,kind:'patrol',date:day}];
 const remote=[{id:'server-a',clientRecordId:'a',siteId:SITES[0].id,kind:'patrol',date:day},{id:'c',siteId:SITES[1].id,kind:'patrol',date:day},{id:'bad',siteId:'outside-project',kind:'patrol',date:day}];
 const rows=mergeRecords(local,remote),stats=visitStats(SITES,rows,day);
 assert.equal(stats.patrolCount,3);assert.equal(stats.patrolSites,2);assert.equal(stats.patrolPercent,20);
});
test('daily record keys follow Shanghai even at UTC midnight boundaries',()=>{
 assert.equal(dateKey(Date.parse('2026-10-02T17:00:00Z')),'2026-10-03');
 assert.equal(dateKey(Date.parse('2026-10-02T15:00:00Z')),'2026-10-02');
});
test('reference photos and portrait gifts retain meaningful model input',()=>{
 assert.match(creationPrompt(SITES[0],'明信片','暖色',4),/4 张参考照片/);
 assert.match(creationPrompt(SITES[0],'明信片','暖色',4),/综合所有照片/);
 assert.equal(generationSize('手机壁纸'),'1024x1536');
 assert.equal(generationSize('明信片'),'1536x1024');
});
test('priority ranking responds to actual patrols and shared materials',()=>{
 const site=SITES[3];
 const before=buildScoredSites([site],[],[])[0].protectionScore;
 const after=buildScoredSites([site],[{siteId:site.id,kind:'patrol',createdAt:Date.now()}],[{siteId:site.id,imageUrl:'https://example.test/p.jpg'}])[0].protectionScore;
 assert.ok(after.forgottenIndex<before.forgottenIndex);
 assert.equal(after.publicCount,1);
});
