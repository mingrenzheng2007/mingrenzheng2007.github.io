import test from 'node:test';
import assert from 'node:assert/strict';
import {SITES} from '../great-wall-data.js';
import {distanceMeters,dateKey,imageUrl,visitStats,mergeRecords,creationPrompt,generationSize,escapeHtml,normalizeArchiveEntry,serviceErrorMessage,formatTime} from '../great-wall-core.js';
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
 const prompt=creationPrompt(SITES[0],'Postcard','Warm watercolor',4);
 assert.match(prompt,/4 reference photos/);
 assert.match(prompt,/all supplied photos/);
 assert.match(prompt,/lettering and captions in the image must be in English/);
 assert.doesNotMatch(prompt,/[\p{Script=Han}]/u);
 assert.equal(generationSize('Phone wallpaper'),'1024x1536');
 assert.equal(generationSize('Postcard'),'1536x1024');
 assert.equal(generationSize('手机壁纸'),'1024x1536');
});
test('priority ranking responds to actual patrols and shared materials',()=>{
 const site=SITES[3];
 const before=buildScoredSites([site],[],[])[0].protectionScore;
 const after=buildScoredSites([site],[{siteId:site.id,kind:'patrol',createdAt:Date.now()}],[{siteId:site.id,imageUrl:'https://example.test/p.jpg'}])[0].protectionScore;
 assert.ok(after.forgottenIndex<before.forgottenIndex);
 assert.equal(after.publicCount,1);
});
test('legacy archive labels become English without losing IDs, images, or user notes',()=>{
 const blob=new Blob(['image'],{type:'image/png'});
 const old={id:'saved-before-english',jobId:'original-job',siteId:SITES[0].id,siteName:'转角楼墩台',title:'转角楼墩台 · 明信片',designType:'明信片',role:'warden',roleText:'文保员',note:'Keep this personal note.',blob};
 const item=normalizeArchiveEntry(old,SITES);
 assert.equal(item.siteName,SITES[0].name);assert.equal(item.designType,'Postcard');assert.equal(item.roleText,'Warden');
 assert.equal(item.title,SITES[0].name+' · Postcard');assert.equal(item.blob,blob);assert.equal(item.note,old.note);assert.equal(item.id,old.id);assert.equal(item.jobId,old.jobId);
});
test('built-in site content and dates are English while reference scores survive translation',()=>{
 assert.doesNotMatch(JSON.stringify(SITES),/[\p{Script=Han}]/u);
 assert.doesNotMatch(formatTime(Date.now()),/[\p{Script=Han}]/u);
 const site=SITES[3],shorter={...site,story:'Shorter English wording.',protectionTip:'Brief advice.'};
 assert.deepEqual(buildScoredSites([site],[],[])[0].protectionScore,buildScoredSites([shorter],[],[])[0].protectionScore);
});
test('Chinese server errors produce readable English with expired tasks identifiable',()=>{
 assert.match(serviceErrorMessage('生图任务不存在或已过期。',404),/not found.*expired/);
 assert.doesNotMatch(serviceErrorMessage('生成失败，请稍后重试。',500),/[\p{Script=Han}]/u);
 assert.equal(serviceErrorMessage('Upstream unavailable',502),'Upstream unavailable');
});
