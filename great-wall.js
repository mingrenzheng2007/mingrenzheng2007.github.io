import {SITES} from './great-wall-data.js';
import {API_BASE,IMAGE_MODEL,DESIGN_TYPES,KIND_LABELS,normalizeArchiveEntry,serviceErrorMessage,escapeHtml as e,imageUrl,dateKey,formatTime,distanceMeters,formatDistance,mergeRecords,visitStats,creationPrompt,generationSize,request} from './great-wall-core.js';
import {readArchive,saveArchive,removeArchive,imageBlob} from './great-wall-store.js';
import {buildScoredSites} from './great-wall-scores.js';

const $ = id => document.getElementById(id);
const icon = name => '<svg class="gw-icon" aria-hidden="true"><use href="#gwi-' + name + '"/></svg>';
const siteById = id => SITES.find(s=>s.id===id) || SITES[0];
const storageRead = key => {try {return JSON.parse(localStorage.getItem('gw.'+key));} catch {return null;}};
const storageWrite = (key,value) => {try {value == null ? localStorage.removeItem('gw.'+key) : localStorage.setItem('gw.'+key,JSON.stringify(value));} catch(error) {console.warn('Great Wall settings storage failed',error);}};
const state = {
  tab:'map',siteId:SITES[0].id,role:storageRead('role') || 'volunteer',location:null,
  records:[],creations:[],remote:[],gallery:[],galleryLoading:false,galleryError:'',activityError:'',
  journalFilter:'all',galleryFilter:'all',historyFilter:'all',sort:'priority',
  mapPhoto:null,mapNote:'',detailPhoto:null,detailNote:'',photos:[],designType:'Postcard',
  pending:normalizeArchiveEntry(storageRead('pending'),SITES),generation:null,generationStarted:0,currentCreation:null,
  storageReady:false
};
let map,tileLayer,markers = new Map(),userMarker,confirmResolve,toastTimer;
const objectUrls = new Map();
let tileSuccess = false;

function blobUrl(blob,key) {
  if (!blob) return '';
  if (!objectUrls.has(key)) objectUrls.set(key,URL.createObjectURL(blob));
  return objectUrls.get(key);
}
function releaseUrl(key) {if(objectUrls.has(key)){URL.revokeObjectURL(objectUrls.get(key));objectUrls.delete(key);}}
function photoUrl(item) {return item.blob ? blobUrl(item.blob,item.id) : imageUrl(item.imageUrl || item.photoPath);}
function sitePhoto(site) {return imageUrl(site.imagePath);}
function empty(title,detail,action) {
  return '<div class="gw-empty">'+icon('tower')+'<strong>'+e(title)+'</strong><p>'+e(detail)+'</p>'+(action||'')+'</div>';
}
function toast(message) {
  clearTimeout(toastTimer);$('gw-toast').textContent=message;$('gw-toast').hidden=false;
  toastTimer=setTimeout(()=>$('gw-toast').hidden=true,4200);
}
function showError(target,error) {
  console.error('Great Wall request/action failed',error);
  $(target).textContent=error.message || String(error);$(target).hidden=false;
}
function confirmAction(title,message) {
  $('gw-confirm-title').textContent=title;$('gw-confirm-text').textContent=message;
  $('gw-confirm-dialog').showModal();
  return new Promise(resolve=>{confirmResolve=resolve;});
}
function showImage(url,caption) {
  if(!url)return;
  $('gw-dialog-image').src=url;$('gw-dialog-image').alt=caption||'Great Wall photo';
  $('gw-dialog-caption').textContent=caption||'';$('gw-image-dialog').showModal();
}
function filters(target,items,selected,action) {
  $(target).innerHTML=items.map(([value,label])=>'<button type="button" data-action="'+action+'" data-value="'+value+'" aria-pressed="'+(selected===value)+'">'+label+'</button>').join('');
}
function selectedSite() {return siteById(state.siteId);}
function localStats() {return visitStats(SITES,state.records);}
function metricStats() {return visitStats(SITES,mergeRecords(state.records,state.remote));}

async function hydrate() {
  const archive=(await readArchive()).map(item=>normalizeArchiveEntry(item,SITES));
  state.records=archive.filter(x=>x.kind!=='creation');
  state.creations=archive.filter(x=>x.kind==='creation');
  state.storageReady=true;
  if(state.currentCreation)state.currentCreation=state.creations.find(x=>x.id===state.currentCreation.id)||state.currentCreation;
  else state.currentCreation=state.creations[0]||null;
}
function selectSite(id,where) {
  const next=siteById(id);
  if(next.id!==state.siteId) {
    state.mapPhoto=null;state.detailPhoto=null;state.mapNote='';state.detailNote='';
    releaseUrl('map-upload');releaseUrl('detail-upload');
  }
  state.siteId=next.id;
  renderMapCard();renderJournal();renderMapMarkers();
  if(where)navigate(where,next.id);
}
function navigate(tab,siteId) {
  const hash='#'+tab+(siteId?'?site='+encodeURIComponent(siteId):'');
  if(location.hash===hash)showTab(true);
  else location.hash=hash;
}
function showTab(scroll) {
  const hash=location.hash.slice(1);
  const [name,query]=hash.split('?');
  state.tab=['map','journal','workshop','gallery','history','forgotten'].includes(name)?name:'map';
  const id=new URLSearchParams(query||'').get('site');
  if(id && SITES.some(s=>s.id===id))state.siteId=id;
  document.querySelectorAll('.gw-tabs button').forEach(b=>{
    const selected=b.dataset.tab===state.tab;
    b.setAttribute('aria-selected',selected);b.tabIndex=selected?0:-1;
  });
  document.querySelectorAll('[role=tabpanel]').forEach(p=>p.hidden=p.id!=='panel-'+state.tab);
  if(state.tab==='map'){renderMapCard();requestAnimationFrame(()=>{initMap();map?.invalidateSize();renderMapMarkers();});}
  if(state.tab==='journal')renderJournal();
  if(state.tab==='history')renderHistory();
  if(state.tab==='workshop'){$('workshop-site').value=state.siteId;renderWorkshopResult();}
  if(state.tab==='gallery'){renderGallery();if(!state.galleryLoading)refreshGallery();}
  if(state.tab==='forgotten')renderForgotten();
  if(scroll && ['map','journal','workshop','gallery','history','forgotten'].includes(name))$('gw-workspace').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}

function initMap() {
  if(map)return;
  if(!window.L){$('map-warning').textContent='The map component did not load. Refresh the page or browse all sites in the site journal.';$('map-warning').hidden=false;return;}
  map=L.map('gw-map',{zoomControl:false,scrollWheelZoom:false}).fitBounds(SITES.map(s=>[s.latitude,s.longitude]),{padding:[40,50]});
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
  tileLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
  }).addTo(map);
  tileLayer.on('tileload',()=>{tileSuccess=true;$('map-warning').hidden=true;});
  tileLayer.on('tileerror',()=>{if(!tileSuccess){$('map-warning').textContent='The basemap is temporarily unavailable. You can still select sites. Try refreshing later.';$('map-warning').hidden=false;}});
  SITES.forEach((s,i)=>{
    const marker=L.marker([s.latitude,s.longitude],{title:s.name}).addTo(map);
    marker.bindTooltip(s.shortName,{direction:'top',offset:[0,-22]});
    marker.on('click',()=>selectSite(s.id));
    markers.set(s.id,{marker,index:i});
  });
  renderMapMarkers();
}
function renderMapMarkers() {
  if(!map)return;
  const visited=new Set(state.records.map(x=>x.siteId));
  markers.forEach(({marker,index},id)=>{
    const selected=id===state.siteId;
    marker.setIcon(L.divIcon({
      className:'gw-pin-icon',html:'<div class="gw-pin-circle '+(selected?'selected':visited.has(id)?'visited':'')+'"><span>'+(index+1)+'</span></div>',
      iconSize:selected?[35,35]:[29,29],iconAnchor:selected?[17,35]:[14,29]
    }));
    marker.setZIndexOffset(selected?1000:0);
  });
}
function renderMapCard() {
  const site=selectedSite();
  const distance=distanceMeters(state.location,site);
  const visited=state.records.some(r=>r.siteId===site.id);
  const summary=site.story.length>160?site.story.slice(0,160).replace(/\s+\S*$/,'')+'…':site.story;
  $('map-site-card').innerHTML=
    '<img class="gw-cover" src="'+sitePhoto(site)+'" alt="'+e(site.name)+'" data-action="site-photo" data-site="'+site.id+'">'+
    '<div class="gw-selected-body"><h3>'+e(site.name)+'</h3><div class="gw-badges"><span class="gw-badge">'+e(site.typeName)+'</span><span class="gw-badge neutral">'+(visited?'Recorded':'Not recorded')+'</span></div>'+
    '<p class="gw-selected-summary">'+e(summary)+'</p>'+
    '<div class="gw-form-line"><span>Your role</span><div class="gw-segment"><button data-action="role" data-value="volunteer" aria-pressed="'+(state.role==='volunteer')+'">Volunteer</button><button data-action="role" data-value="warden" aria-pressed="'+(state.role==='warden')+'">Warden</button></div></div>'+
    '<div class="gw-form-line"><span>Location</span><span class="gw-location-text">'+icon('pin')+' '+(distance==null?'Location not set':'From the demo site: '+e(formatDistance(distance)))+'</span><button class="gw-link" data-action="locate">Locate me</button></div>'+
    '<label class="gw-field-label" for="map-photo">Field photo (optional)</label>'+
    (state.mapPhoto?'<div class="gw-photo-small"><img src="'+blobUrl(state.mapPhoto,'map-upload')+'" alt="Field photo awaiting save"><button aria-label="Remove photo" data-action="clear-map-photo">×</button></div>':'<label class="gw-upload" for="map-photo">'+icon('camera')+'Add a field photo</label>')+
    '<input id="map-photo" class="gw-file-input" type="file" accept="image/*">'+
    '<label for="map-note" class="gw-field-label">Observation (optional)</label><textarea id="map-note" rows="2" maxlength="180" placeholder="Describe the walls, surroundings, or changes you notice.">'+e(state.mapNote)+'</textarea>'+
    '<div class="gw-action-pair"><button class="gw-button primary" data-action="save-visit">'+(state.role==='warden'?'Save a patrol':'Save a visit')+'</button><button class="gw-button secondary" data-action="open-journal" data-site="'+site.id+'">Site journal</button></div>'+
    '<p class="gw-input-note">Visits require location access. Demo coordinates are not for navigation. Save remote observations in the site journal.</p>'+
    '<div id="map-action-error" class="gw-alert error" role="alert" hidden></div></div>';
  const latest=state.records[0];
  $('map-recent').innerHTML=latest?'<div class="gw-recent-item"><img src="'+(photoUrl(latest)||sitePhoto(siteById(latest.siteId)))+'" alt="'+e(latest.siteName)+'"><div><strong>'+e(latest.siteName)+'</strong><small>'+e(KIND_LABELS[latest.kind])+' · '+formatTime(latest.createdAt)+'</small></div><button class="gw-link" data-action="go-history">View →</button></div>':empty('Your first entry is waiting','Choose a site and add an observation. Every entry becomes part of your Great Wall journal.');
}

async function locate() {
  if(!navigator.geolocation)throw new Error('This browser does not support location access. Try another browser.');
  toast('Finding your location. Please allow location access.');
  const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,err=>reject(new Error(err.code===1?'Location permission was denied. You can still save remote observations in the site journal.':'Unable to get your location. Check your device location settings and try again.')),{enableHighAccuracy:true,timeout:15000,maximumAge:30000}));
  state.location={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
  if(map){
    if(userMarker)map.removeLayer(userMarker);
    userMarker=L.circleMarker([state.location.latitude,state.location.longitude],{radius:7,color:'#fff',weight:3,fillColor:'#3b89bf',fillOpacity:1}).addTo(map).bindTooltip('Location');
  }
  renderMapCard();toast('Location found. Distances use the demo coordinates.');
}
async function storeRecord(kind,note,blob,location) {
  if(!state.storageReady)throw new Error('Your local journal is not ready. Refresh and try again.');
  const site=selectedSite(),distance=distanceMeters(location,site);
  const item={id:crypto.randomUUID(),kind,siteId:site.id,siteName:site.name,note,blob:blob||null,role:state.role,roleText:state.role==='warden'?'Warden':'Volunteer',createdAt:Date.now(),date:dateKey(),distanceMeters:distance,inRange:distance!=null&&distance<=site.visitRadius,syncStatus:kind==='story'?'local':'pending',published:false};
  await saveArchive(item);await hydrate();renderAll();
  if(kind!=='story')syncRecord(item).catch(error=>console.warn('Record sync deferred',error));
  return item;
}
async function saveVisit() {
  if(!state.location)throw new Error('Get your location first. If you are not on site, save an observation in the site journal.');
  const distance=distanceMeters(state.location,selectedSite());
  if(distance>selectedSite().visitRadius)throw new Error('You are about '+formatDistance(distance)+' from the demo site. This cannot be saved as an on-site visit. Save a remote observation in the site journal instead.');
  await storeRecord(state.role==='warden'?'patrol':'checkin',state.mapNote,state.mapPhoto,state.location);
  state.mapPhoto=null;state.mapNote='';releaseUrl('map-upload');renderMapCard();toast('Saved to your records.');
}
async function saveObservation() {
  if(!state.detailNote.trim() && !state.detailPhoto)throw new Error('Write an observation or add a photo.');
  await storeRecord(state.role==='warden'?'patrol':'story',state.detailNote.trim(),state.detailPhoto,null);
  state.detailPhoto=null;state.detailNote='';releaseUrl('detail-upload');renderJournal();toast('Observation saved to your local journal.');
}
async function syncRecord(item) {
  try {
    await request('/v1/site-activity/report',{body:{clientRecordId:item.id,siteId:item.siteId,siteName:item.siteName,kind:item.kind,role:item.role,date:item.date,createdAt:item.createdAt,distanceMeters:item.distanceMeters||0,inRange:item.inRange,hasPhoto:Boolean(item.blob)}});
    item.syncStatus='synced';item.syncError='';
  } catch(error) {item.syncStatus='failed';item.syncError=error.message;console.warn('Great Wall activity sync failed',error);}
  // A user may delete a record while its request is in flight. Do not restore it.
  if(state.records.some(x=>x.id===item.id)){await saveArchive(item);await hydrate();renderHistory();}
  refreshActivity();
}

function renderJournal() {
  filters('journal-filters',[['all','All'],['beacon','Beacon tower'],['fort','Fort'],['viewpoint','Viewpoint']],state.journalFilter,'journal-filter');
  const list=SITES.filter(s=>state.journalFilter==='all'||s.type===state.journalFilter);
  $('journal-list').innerHTML=list.map(s=>'<button class="gw-site-item '+(s.id===state.siteId?'selected':'')+'" data-action="select-story" data-site="'+s.id+'"><img src="'+sitePhoto(s)+'" alt="'+e(s.name)+'" loading="lazy"><span><h3>'+e(s.name)+'</h3><span class="gw-badge">'+e(s.typeName)+'</span><p>'+e(s.coverText)+'</p></span></button>').join('');
  const site=selectedSite();
  $('journal-detail').innerHTML='<img class="gw-detail-photo" src="'+sitePhoto(site)+'" alt="'+e(site.name)+'" data-action="site-photo" data-site="'+site.id+'"><div class="gw-detail-body"><span class="gw-badge">'+e(site.typeName)+'</span><h3>'+e(site.name)+'</h3>'+
    '<h4>'+icon('book')+'The story</h4><p>'+e(site.story)+'</p><h4>'+icon('leaf')+'How to care for this site</h4><p>'+e(site.protectionTip)+'</p>'+
    '<div class="gw-action-pair"><button class="gw-button primary" data-action="open-map" data-site="'+site.id+'">'+icon('map')+'View on map</button><button class="gw-button secondary" data-action="site-workshop" data-site="'+site.id+'">'+icon('palette')+'Create a design</button></div>'+
    '<details class="gw-observation" id="observation-form"><summary>Add an observation · '+(state.role==='warden'?'Warden patrol':'Volunteer story')+'</summary><div><label class="gw-field-label" for="detail-note">On-site or remote observation</label><textarea id="detail-note" rows="3" maxlength="180" placeholder="Record a discovery, local memory, or change that deserves attention.">'+e(state.detailNote)+'</textarea>'+
    (state.detailPhoto?'<div class="gw-photo-small"><img src="'+blobUrl(state.detailPhoto,'detail-upload')+'" alt="Observation photo awaiting save"><button data-action="clear-detail-photo" aria-label="Remove photo">×</button></div>':'<label class="gw-upload" for="detail-photo">'+icon('camera')+'Add a photo (optional)</label>')+
    '<input id="detail-photo" type="file" accept="image/*" class="gw-file-input"><button class="gw-button primary full" data-action="save-observation">Save '+(state.role==='warden'?'patrol':'story')+'</button><p class="gw-input-note">Entries without an on-site location are marked as remote observations and do not count as visits.</p><div id="detail-action-error" class="gw-alert error" hidden role="alert"></div></div></details>'+
    '<p class="gw-source">Photo: <a href="'+e(site.imageSourceUrl)+'" target="_blank" rel="noopener">'+e(site.imageSource)+'</a></p><p class="gw-source">'+e(site.sourceNote)+'</p></div>';
}

function renderWorkshopSetup() {
  $('workshop-site').innerHTML=SITES.map(s=>'<option value="'+s.id+'">'+e(s.name)+'</option>').join('');
  $('workshop-site').value=state.siteId;
  const symbols=['tower','book','camera','share','pin'];
  $('design-types').innerHTML=DESIGN_TYPES.map((type,i)=>'<label class="gw-design-type">'+icon(symbols[i])+'<span>'+type+'</span><input type="radio" name="design-type" value="'+type+'" '+(type===state.designType?'checked':'')+'></label>').join('');
  renderPhotoList();renderWorkshopResult();
}
function renderPhotoList() {
  $('workshop-photo-list').innerHTML=state.photos.map((b,i)=>'<div class="gw-photo-small"><img src="'+blobUrl(b,'workshop-upload-'+i)+'" alt="Reference photo '+(i+1)+'"><button type="button" aria-label="Remove reference photo '+(i+1)+'" data-action="remove-reference" data-index="'+i+'">×</button></div>').join('');
}
function renderWorkshopResult() {
  const current=state.currentCreation;
  $('creation-preview').innerHTML=current?
    '<img class="gw-result-image" src="'+photoUrl(current)+'" alt="'+e(current.siteName+' · '+current.designType)+'" data-action="creation-photo" data-id="'+current.id+'"><div class="gw-result-actions"><button class="gw-button primary" data-action="download" data-id="'+current.id+'">'+icon('download')+'Download design</button><a href="#history" class="gw-button secondary">'+icon('record')+'Design archive</a><button class="gw-button secondary" data-action="share" data-id="'+current.id+'" '+(current.published?'disabled':'')+'>'+icon('share')+(current.published?'Shared':'Share publicly')+'</button></div>':
    '<div class="gw-preview-empty"><img class="gw-keepsake-mascot" src="assets/great-wall/watchtower-mascot.png" alt="" aria-hidden="true"><h4>A keepsake from the loess hills.</h4><p>Choose a site and a keepsake type.<br>Your first Great Wall design starts here.</p></div>';
  $('recent-creations').innerHTML=state.creations.length?state.creations.slice(0,5).map(c=>'<button data-action="select-creation" data-id="'+c.id+'"><img src="'+photoUrl(c)+'" alt="'+e(c.designType)+'" loading="lazy"><span>'+e(c.designType)+'</span></button>').join(''):'<p class="gw-input-note">Completed designs are saved automatically in this browser.</p>';
  $('workshop-inputs').disabled=Boolean(state.generation);
  renderGenerationStatus();
}
function renderGenerationStatus(message) {
  const pending=state.pending;
  const active=Boolean(state.generation);
  $('generation-status').hidden=!pending&&!active;
  if(!pending&&!active)return;
  $('generation-status').innerHTML='<strong>'+(active?'<span class="gw-spinner"></span>':'')+e(message||(active?'Creating your Great Wall keepsake…':'Waiting is paused'))+'</strong>'+
    '<p>The server continues after submission. You can switch tools or refresh, then resume checking. Completed designs are saved automatically.</p>'+
    (active?'<button type="button" class="gw-link" data-action="pause-generation">Stop waiting</button>':'<button type="button" class="gw-button secondary small" data-action="resume-generation">Resume this task</button>')+
    '<p>Stopping the wait does not cancel the submitted server task.</p>';
}
async function uploadReference(blob,signal,index) {
  const form=new FormData();form.append('image',blob,'reference-'+index+'.jpg');form.append('mimeType',blob.type);
  const result=await request('/v1/images/upload-reference',{body:form,signal,timeout:60000});
  if(!result?.uploadId)throw new Error('The reference photo upload returned no ID. Please try again.');
  return result.uploadId;
}
async function generate() {
  $('workshop-error').hidden=true;
  if(state.generation)return;
  if(state.pending){await resumeGeneration();return;}
  const controller=new AbortController();state.generation=controller;
  state.generationStarted=Date.now();renderWorkshopResult();
  try {
    if(!state.storageReady)throw new Error('Your local journal is not ready to save a design.');
    const site=siteById($('workshop-site').value),note=$('workshop-note').value.trim(),type=state.designType;
    const health=await request('/health',{signal:controller.signal});
    if(!health.models?.image?.some(x=>(typeof x==='string'?x:x.name)===IMAGE_MODEL))throw new Error('The required image model is not registered. Please contact the site maintainer.');
    const imageIds=[];
    for(let i=0;i<state.photos.length;i++){
      renderGenerationStatus('Uploading reference photo '+(i+1)+' / '+state.photos.length);
      imageIds.push(await uploadReference(state.photos[i],controller.signal,i));
    }
    const response=await request('/v1/images/generate',{body:{model:IMAGE_MODEL,prompt:creationPrompt(site,type,note,state.photos.length),size:generationSize(type),quality:'medium',imageIds},signal:controller.signal,timeout:30000});
    if(!response?.jobId)throw new Error('The generation request returned no task ID. Try again later.');
    state.pending={jobId:response.jobId,siteId:site.id,siteName:site.name,designType:type,note,createdAt:Date.now()};
    storageWrite('pending',state.pending);renderGenerationStatus('Submitted. Your design is in the queue…');
    await pollGeneration(controller.signal);
  } catch(error) {
    if(error.name!=='AbortError')showError('workshop-error',error);
  } finally {
    if(state.generation===controller)state.generation=null;
    renderWorkshopResult();
  }
}
async function resumeGeneration() {
  if(state.generation || !state.pending)return;
  $('workshop-error').hidden=true;
  const controller=new AbortController();state.generation=controller;renderWorkshopResult();
  try {await pollGeneration(controller.signal);}
  catch(error){if(error.name!=='AbortError')showError('workshop-error',error);}
  finally {if(state.generation===controller)state.generation=null;renderWorkshopResult();}
}
async function delay(ms,signal) {
  if(signal.aborted)throw new DOMException('Stop waiting','AbortError');
  await new Promise((resolve,reject)=>{
    const onAbort=()=>{clearTimeout(timer);reject(new DOMException('Stop waiting','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},ms);
    signal.addEventListener('abort',onAbort,{once:true});
  });
}
async function pollGeneration(signal) {
  const job=state.pending;
  let failures=0;
  for(let attempt=0;attempt<150;attempt++) {
    if(signal.aborted)throw new DOMException('Stop waiting','AbortError');
    let result;
    try {
      result=await request('/v1/images/generate/status?jobId='+encodeURIComponent(job.jobId),{signal});
      failures=0;
    } catch(error) {
      if(error.name==='AbortError')throw error;
      if(error.status===404 || /not found|expired/i.test(error.message)){state.pending=null;storageWrite('pending',null);throw error;}
      if(++failures>=3)throw error;
      renderGenerationStatus('The status check was interrupted. Reconnecting…');await delay(3000,signal);continue;
    }
    if(result.status==='failed'){state.pending=null;storageWrite('pending',null);console.warn('Image generation failed',result.error);throw new Error(serviceErrorMessage(result.error||'Design generation failed. Try again later.'));}
    if(result.status==='complete') {
      renderGenerationStatus('Your design is ready. Saving it to your journal…');
      let blob;
      const url=imageUrl(result.data?.imageUrl);
      if(url){
        const response=await fetch(url,{signal});
        if(!response.ok)throw new Error('Your design was generated, but its download failed (HTTP '+response.status+'). Resume this task to retry saving it.');
        blob=await response.blob();
      } else if(result.data?.imageBase64){
        const bytes=Uint8Array.from(atob(result.data.imageBase64),c=>c.charCodeAt(0));blob=new Blob([bytes],{type:result.data.mimeType||'image/png'});
      } else throw new Error('The service returned no readable image.');
      if(!blob.size || !blob.type.startsWith('image/'))throw new Error('The returned file is not an image. Try again later.');
      const item={...job,id:'creation-'+job.jobId,kind:'creation',blob,published:false};
      // Save first: a failed write keeps the pending job available for a retry.
      await saveArchive(item);state.pending=null;storageWrite('pending',null);state.currentCreation=item;
      await hydrate();renderAll();toast('Your design is ready and saved to your records.');return;
    }
    renderGenerationStatus(result.status==='queued'?'Queued. Generation will start automatically…':'Drawing the Great Wall. Your design will be saved when it is ready…');
    await delay(3000,signal);
  }
  throw new Error('This is taking longer than expected. Your task ID is saved. Use “Resume this task” to check again later.');
}

async function refreshGallery() {
  if(state.galleryLoading)return;
  state.galleryLoading=true;state.galleryError='';renderGallery();
  try {
    const rows=await request('/v1/gallery?limit=80');
    const ids=new Set(SITES.map(s=>s.id));
    state.gallery=(rows||[]).filter(x=>ids.has(x.siteId)).map(x=>normalizeArchiveEntry(x,SITES));
  } catch(error){state.galleryError=error.message;console.warn('Great Wall gallery failed',error);}
  finally {state.galleryLoading=false;renderGallery();renderForgotten();}
}
function renderGallery() {
  filters('gallery-filters',[['all','All'],['footprint','Field photos'],['creation','AI studio']],state.galleryFilter,'gallery-filter');
  $('gallery-status').innerHTML=state.galleryError?'<div class="gw-alert error">Community content is unavailable: '+e(state.galleryError)+' <button class="gw-link" data-action="refresh-gallery">Retry</button></div>':state.galleryLoading?'<div class="gw-alert info"><span class="gw-spinner"></span>Loading community content…</div>':'';
  const rows=state.gallery.filter(x=>state.galleryFilter==='all'||x.kind===state.galleryFilter);
  $('gallery-grid').innerHTML=rows.length?rows.map(x=>'<article class="gw-card gw-gallery-card"><button data-action="gallery-photo" data-id="'+e(x.id)+'" aria-label="Enlarge '+e(x.title)+'"><img src="'+e(imageUrl(x.imageUrl))+'" alt="'+e(x.title)+'" loading="lazy"></button><div class="gw-gallery-body"><div class="gw-gallery-meta"><span class="gw-badge">'+(x.kind==='creation'?'AI studio':'Field photos')+'</span><span>'+formatTime(x.createdAt)+'</span></div><h3>'+e(x.title)+'</h3><p>'+e(x.note||x.siteName)+'</p><button class="gw-link" data-action="open-journal" data-site="'+e(x.siteId)+'">View site →</button></div></article>').join(''):
    !state.galleryLoading&&!state.galleryError?'<div style="grid-column:1/-1">'+empty('The first shared memory starts here','Choose a photo or design in your records and share it publicly for others to discover.','<a href="#history" class="gw-link">Share from my records →</a>')+'</div>':'';
}
async function refreshActivity() {
  try {const data=await request('/v1/site-activity?limit=300');state.remote=data?.records||[];state.activityError='';}
  catch(error){state.activityError=error.message;console.warn('Great Wall statistics failed',error);}
  renderForgotten();
}
function renderHistory() {
  filters('history-filters',[['all','All'],['checkin','Visits'],['patrol','Patrols'],['story','Stories']],state.historyFilter,'history-filter');
  const stats=localStats();
  $('history-stats').innerHTML=[
    ['record','Patrols today',stats.patrolCount],['pin','Sites patrolled',stats.patrolSites+'/'+stats.total],
    ['map','Patrol coverage',stats.patrolPercent+'%'],['camera','Visits today',stats.checkinToday]
  ].map(([sym,label,value])=>'<div class="gw-stat">'+icon(sym)+'<div><span>'+label+'</span><b>'+value+'</b></div></div>').join('');
  const rows=state.records.filter(r=>state.historyFilter==='all'||r.kind===state.historyFilter);
  $('history-list').innerHTML=rows.length?rows.map(r=>{
    const pic=photoUrl(r)||sitePhoto(siteById(r.siteId));
    const sync=r.kind==='story'?'':r.syncStatus==='synced'?'<p class="gw-sync-note success">Patrol / visit metadata synced. Photos and notes remain private.</p>':
      '<p class="gw-sync-note">'+(r.syncStatus==='pending'?'Syncing activity metadata…':'Saved locally. Activity sync failed.')+(r.syncStatus==='failed'?'<button class="gw-link" data-action="retry-sync" data-id="'+r.id+'">Retry sync</button>':'')+'</p>';
    return '<article class="gw-history-item"><div class="gw-history-item-top"><img src="'+pic+'" alt="'+e(r.siteName)+'" data-action="record-photo" data-id="'+r.id+'"><div class="gw-history-item-main"><h3>'+e(r.siteName)+'</h3><span class="gw-badge">'+e(KIND_LABELS[r.kind])+'</span> <small>'+formatTime(r.createdAt)+' · '+e(r.roleText)+'</small><p>'+e(r.note||'A new entry in your Great Wall journal.')+'</p><small>'+(r.distanceMeters==null?'Remote observation':r.inRange?'Within the demo location range':'Location not confirmed')+'</small>'+sync+'</div></div><div class="gw-history-actions"><button class="gw-link" data-action="open-journal" data-site="'+r.siteId+'">View site</button>'+
      (r.blob?'<button class="gw-link" data-action="download" data-id="'+r.id+'">Download photo</button><button class="gw-link" data-action="share" data-id="'+r.id+'" '+(r.published?'disabled':'')+'>'+ (r.published?'Shared publicly':'Share publicly')+'</button>':'')+
      '<button class="gw-link gw-delete" data-action="delete-record" data-id="'+r.id+'">Delete local record</button></div></article>';
  }).join(''):empty('No records of this type yet','Save a visit from the map or add an observation in the site journal.','<a href="#journal" class="gw-link">Explore a site →</a>');
  $('history-creations').innerHTML=state.creations.length?state.creations.map(c=>'<div class="gw-saved-art"><img src="'+photoUrl(c)+'" alt="'+e(c.designType)+'" data-action="creation-photo" data-id="'+c.id+'"><h4>'+e(c.siteName)+' · '+e(c.designType)+'</h4><div class="gw-result-actions"><button class="gw-button secondary small" data-action="download" data-id="'+c.id+'">Download</button><button class="gw-button secondary small" data-action="share" data-id="'+c.id+'" '+(c.published?'disabled':'')+'>'+(c.published?'Shared':'Share')+'</button><button class="gw-link gw-delete" data-action="delete-record" data-id="'+c.id+'">Delete</button></div></div>').join(''):empty('No designs yet','Create your first Great Wall keepsake in the AI studio.','<a href="#workshop" class="gw-link">Start creating →</a>');
}
function renderForgotten() {
  filters('forgotten-filters',[['priority','Overall priority'],['patrol','Patrol gaps'],['public','Documentation gaps'],['risk','Reference risk']],state.sort,'sort');
  const rows=buildScoredSites(SITES,mergeRecords(state.records,state.remote),state.gallery);
  const risk=s=>s.protectionScore.metrics.find(m=>m.key==='risk').value;
  rows.sort((a,b)=>state.sort==='patrol'?b.protectionScore.latestPatrolDays-a.protectionScore.latestPatrolDays:state.sort==='public'?a.protectionScore.publicCount-b.protectionScore.publicCount:state.sort==='risk'?risk(b)-risk(a):b.protectionScore.forgottenIndex-a.protectionScore.forgottenIndex);
  $('forgotten-list').innerHTML=rows.map((s,i)=>{
    const score=s.protectionScore;
    const reasons=score.reasons.map(r=>r==='Higher reference risk'?'Higher risk in the project reference settings':r).join(' · ');
    return '<article class="gw-ranking-card"><b class="gw-rank-number">'+(i+1)+'</b><img src="'+sitePhoto(s)+'" alt="'+e(s.name)+'" loading="lazy"><div><h3>'+e(s.name)+'</h3><span class="gw-badge">'+(score.priority==='High'?'Priority site':'Add documentation')+'</span><p>'+e(reasons)+'</p><div class="gw-ranking-meter">Reference risk <i><b style="width:'+Math.min(100,risk(s)*20)+'%"></b></i> Shared items '+score.publicCount+'</div></div><div class="gw-ranking-actions"><button class="gw-button primary" data-action="open-map" data-site="'+s.id+'">Add a record →</button><button class="gw-button secondary" data-action="open-journal" data-site="'+s.id+'">Details</button></div></article>';
  }).join('');
  const stats=metricStats();
  $('activity-status').textContent=state.activityError?'Shared patrols are unavailable. Rankings currently use local records and available material.':'Shared patrols connected. Today: '+stats.patrolCount+' patrol records across '+stats.patrolSites+' sites.';
}

async function download(item) {
  if(!item?.blob)throw new Error('This record has no image to download.');
  const url=URL.createObjectURL(item.blob),a=document.createElement('a');
  const ext=item.blob.type.includes('png')?'png':'jpg';
  a.href=url;a.download=item.siteName+'-'+(item.designType||KIND_LABELS[item.kind])+'.'+ext;
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function share(item) {
  if(!item?.blob)throw new Error('There is no image to share.');
  if(item.published){toast('This item is already shared in the community.');return;}
  const yes=await confirmAction('Share this with the community?','This will make the image, site name, and observation note visible to all visitors. Deleting the local record will not remove the public item.');
  if(!yes)return;
  const form=new FormData();
  form.append('image',item.blob,'guardian-photo.'+(item.blob.type.includes('png')?'png':'jpg'));
  const fields={kind:item.kind==='creation'?'creation':'footprint',siteId:item.siteId,siteName:item.siteName,title:item.siteName+' · '+(item.designType||KIND_LABELS[item.kind]),typeText:item.designType||KIND_LABELS[item.kind],note:item.note||'',roleText:item.roleText||'',mimeType:item.blob.type};
  Object.entries(fields).forEach(([k,v])=>form.append(k,v));
  const published=await request('/v1/gallery/publish',{body:form,timeout:60000});
  item.published=true;item.galleryId=published.id;
  await saveArchive(item);await hydrate();renderAll();toast('Shared with the community.');refreshGallery();
}
async function deleteItem(item) {
  const yes=await confirmAction('Delete this local record?','This removes the record and image from this browser. Synced activity metadata and publicly shared items will remain.');
  if(!yes)return;
  await removeArchive(item.id);releaseUrl(item.id);
  if(state.currentCreation?.id===item.id)state.currentCreation=null;
  await hydrate();renderAll();toast('Local record deleted.');
}
function exportRecords() {
  const data={project:'Fugu Great Wall Guardian',exportedAt:new Date().toISOString(),note:'Download photos and designs separately from each record. This export does not contain image files.',records:state.records.map(({blob,...x})=>({...x,hasPhoto:Boolean(blob)})),creations:state.creations.map(({blob,...x})=>({...x,hasImage:Boolean(blob)}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='great-wall-records-'+dateKey()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderAll() {renderMapCard();renderMapMarkers();renderJournal();renderHistory();renderWorkshopResult();renderGallery();renderForgotten();}

document.addEventListener('click',async event=>{
  const tab=event.target.closest('[data-tab]');
  if(tab){navigate(tab.dataset.tab);return;}
  const b=event.target.closest('[data-action]');
  if(!b)return;
  const action=b.dataset.action,id=b.dataset.id,site=b.dataset.site;
  const item=state.records.concat(state.creations).find(x=>x.id===id);
  const disabling=['save-visit','save-observation','share','retry-sync','delete-record'].includes(action);
  if(disabling){if(b.disabled)return;b.disabled=true;}
  if(disabling)$('gw-global-error').hidden=true;
  try {
    switch(action) {
      case 'role':state.role=b.dataset.value;storageWrite('role',state.role);renderMapCard();renderJournal();break;
      case 'locate':await locate();break;
      case 'save-visit':await saveVisit();break;
      case 'save-observation':await saveObservation();break;
      case 'fit-map':navigate('map');requestAnimationFrame(()=>map?.fitBounds(SITES.map(s=>[s.latitude,s.longitude]),{padding:[40,50]}));break;
      case 'open-journal':selectSite(site,'journal');break;
      case 'open-map':selectSite(site,'map');break;
      case 'select-story':selectSite(site);break;
      case 'site-workshop':$('workshop-site').value=site;selectSite(site,'workshop');break;
      case 'go-history':navigate('history');break;
      case 'journal-filter':state.journalFilter=b.dataset.value;renderJournal();break;
      case 'gallery-filter':state.galleryFilter=b.dataset.value;renderGallery();break;
      case 'history-filter':state.historyFilter=b.dataset.value;renderHistory();break;
      case 'sort':state.sort=b.dataset.value;renderForgotten();break;
      case 'site-photo':showImage(sitePhoto(siteById(site)),siteById(site).name);break;
      case 'record-photo':showImage(photoUrl(item)||sitePhoto(siteById(item.siteId)),item.siteName);break;
      case 'creation-photo':showImage(photoUrl(item),item.siteName+' · '+item.designType);break;
      case 'gallery-photo':{const x=state.gallery.find(x=>x.id===id);showImage(imageUrl(x?.imageUrl),x?.title);break;}
      case 'close-image':$('gw-image-dialog').close();break;
      case 'confirm-yes':$('gw-confirm-dialog').close();confirmResolve?.(true);confirmResolve=null;break;
      case 'confirm-no':$('gw-confirm-dialog').close();confirmResolve?.(false);confirmResolve=null;break;
      case 'clear-map-photo':state.mapPhoto=null;releaseUrl('map-upload');renderMapCard();break;
      case 'clear-detail-photo':state.detailPhoto=null;releaseUrl('detail-upload');renderJournal();$('observation-form').open=true;break;
      case 'remove-reference':state.photos.splice(Number(b.dataset.index),1);for(let i=0;i<5;i++)releaseUrl('workshop-upload-'+i);renderPhotoList();break;
      case 'select-creation':state.currentCreation=item;renderWorkshopResult();break;
      case 'refresh-gallery':await refreshGallery();break;
      case 'pause-generation':state.generation?.abort();break;
      case 'resume-generation':await resumeGeneration();break;
      case 'retry-sync':await syncRecord(item);break;
      case 'download':await download(item);break;
      case 'share':await share(item);break;
      case 'delete-record':await deleteItem(item);break;
      case 'export-records':exportRecords();break;
    }
  } catch(error) {
    const target=['locate','save-visit'].includes(action)?'map-action-error':action==='save-observation'?'detail-action-error':'gw-global-error';
    showError(target,error);toast(error.message);
  } finally {if(disabling && b.isConnected)b.disabled=false;}
});
document.addEventListener('input',event=>{
  if(event.target.id==='map-note')state.mapNote=event.target.value;
  if(event.target.id==='detail-note')state.detailNote=event.target.value;
});
document.addEventListener('change',async event=>{
  const input=event.target;
  try {
    if(input.name==='design-type')state.designType=input.value;
    if(input.id==='workshop-site')state.siteId=input.value;
    if(input.id==='map-photo'&&input.files[0]){state.mapPhoto=await imageBlob(input.files[0]);releaseUrl('map-upload');renderMapCard();}
    if(input.id==='detail-photo'&&input.files[0]){state.detailPhoto=await imageBlob(input.files[0]);releaseUrl('detail-upload');renderJournal();$('observation-form').open=true;}
    if(input.id==='workshop-photos') {
      const files=Array.from(input.files);
      if(state.photos.length+files.length>4)throw new Error('You can add up to 4 reference photos. Remove a photo before adding more.');
      for(const file of files)state.photos.push(await imageBlob(file));
      renderPhotoList();input.value='';
    }
  } catch(error){showError(input.id==='workshop-photos'?'workshop-error':'gw-global-error',error);input.value='';}
});
document.querySelector('.gw-tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const tabs=Array.from(document.querySelectorAll('.gw-tabs button'));
  const index=tabs.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  tabs[next].focus();navigate(tabs[next].dataset.tab);
});
$('workshop-form').addEventListener('submit',event=>{event.preventDefault();generate();});
$('gw-confirm-dialog').addEventListener('cancel',()=>{confirmResolve?.(false);confirmResolve=null;});
window.addEventListener('hashchange',()=>showTab(true));

async function boot() {
  try {await hydrate();}
  catch(error){showError('gw-global-error',error);}
  renderWorkshopSetup();renderAll();showTab(Boolean(location.hash));
  request('/health').then(health=>{
    const ready=health.models?.image?.some(x=>(typeof x==='string'?x:x.name)===IMAGE_MODEL);
    $('ai-connection').textContent=ready?'AI service connected':'Image model not registered';$('ai-connection').classList.add(ready?'ready':'failed');
  }).catch(error=>{$('ai-connection').textContent='AI unavailable · Try again later';$('ai-connection').classList.add('failed');console.warn('AI health failed',error);});
  refreshGallery();refreshActivity();
  if(state.pending){toast('A previous generation task was found. Resume it in the AI studio.');renderGenerationStatus();}
}
boot();
