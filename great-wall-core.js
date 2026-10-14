export const API_BASE = 'https://47.103.59.118/ai';
export const IMAGE_MODEL = 'gpt-image-2';
export const DESIGN_TYPES = ['Fridge magnet', 'Bookmark', 'Postcard', 'Tote bag', 'Phone wallpaper'];
export const KIND_LABELS = {checkin:'Visit', patrol:'Patrol', story:'Story', creation:'Design'};

// Keep existing browser archives and shared items readable after the language change.
const legacyLabels = {'冰箱贴':'Fridge magnet','书签':'Bookmark','明信片':'Postcard','帆布包':'Tote bag','手机壁纸':'Phone wallpaper','足迹':'Visit','巡检':'Patrol','故事':'Story','文创':'Design','志愿者':'Volunteer','文保员':'Warden'};
export const normalizeDesignType = value => legacyLabels[value] || value;
export function normalizeArchiveEntry(item,sites) {
  if(!item)return item;
  const site=sites.find(s=>s.id===item.siteId);
  const result={...item,siteName:site?.name || item.siteName,designType:normalizeDesignType(item.designType),roleText:item.role==='warden'?'Warden':item.role==='volunteer'?'Volunteer':normalizeDesignType(item.roleText)};
  if(item.title && site && item.siteName && item.title.startsWith(item.siteName+' · '))result.title=site.name+' · '+normalizeDesignType(item.title.slice(item.siteName.length+3));
  return result;
}

export function serviceErrorMessage(value,status=0) {
  const text=String(value || '');
  if(!/[\p{Script=Han}]/u.test(text))return text || 'Request failed (HTTP '+status+').';
  if(/不存在|已过期/.test(text))return 'The task or resource was not found or has expired.';
  if(/未登记|未注册|模型不支持/.test(text))return 'The required model is not registered or supported. Contact the site maintainer.';
  if(/超时/.test(text))return 'The service request timed out. Try again later.';
  if(/频繁|限流|限制/.test(text))return 'The service limit was reached. Wait a minute and try again.';
  return 'The service could not complete this request. Try again later.';
}

export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function imageUrl(value) {
  if (!value) return '';
  const text = String(value);
  if (text.startsWith('assets/') || text.startsWith('blob:')) return text;
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' && ['47.103.59.118','yimaweilai.top'].includes(url.hostname)) {
      url.protocol = 'https:';
      url.hostname = '47.103.59.118';
      url.port = '';
    }
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

export function dateKey(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(x => [x.type,x.value]));
  return p.year + '-' + p.month + '-' + p.day;
}

export function formatTime(value) {
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
}

export function distanceMeters(a,b) {
  if (!a || !b) return null;
  const rad = v => Number(v) * Math.PI / 180;
  const h = Math.sin(rad(b.latitude-a.latitude)/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return Math.round(6371000 * 2 * Math.asin(Math.min(1,Math.sqrt(h))));
}

export function formatDistance(value) {
  if (value == null) return 'Location not set';
  return value < 1000 ? value + ' m' : (value / 1000).toFixed(1) + ' km';
}

export function mergeRecords(local = [], remote = []) {
  const seen = new Set();
  return local.concat(remote).filter(x => {
    const id = x.clientRecordId || x.id || [x.kind,x.siteId,x.createdAt].join(':');
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function visitStats(sites,records,date = dateKey()) {
  const valid = new Set(sites.map(s => s.id));
  const today = records.filter(r => valid.has(r.siteId) && r.date === date);
  const patrol = today.filter(r => r.kind === 'patrol');
  const checkins = records.filter(r => valid.has(r.siteId) && r.kind === 'checkin');
  const patrolSites = new Set(patrol.map(r => r.siteId));
  return {total:valid.size,patrolCount:patrol.length,patrolSites:patrolSites.size,patrolPercent:valid.size ? Math.round(patrolSites.size / valid.size * 100) : 0,checkinToday:today.filter(r=>r.kind==='checkin').length,visited:new Set(checkins.map(r=>r.siteId))};
}

export function creationPrompt(site,designType,note,count) {
  return [
    'Create one complete, polished Great Wall keepsake design.',
    'Site: '+site.name+'. Historical context: '+site.story,
    'Keepsake type: '+normalizeDesignType(designType)+'.',
    count ? 'The user supplied '+count+' reference '+(count===1?'photo. ':'photos. ')+'Preserve the main structure. Combine the textures, colors, and details from all supplied photos.' : '',
    'Depict the loess hills, earthen watchtowers, and preservation stories of Fugu, Shaanxi, China. Use clear, warm colors suitable for students and volunteers.',
    'Keep the architecture faithful to Fugu; do not substitute the tourist Great Wall near Beijing. Do not add real brands, QR codes, contact details, or misleading official emblems.',
    note ? 'User style direction: '+note : '',
    'All lettering and captions in the image must be in English. Translate any text requested in another language into English. Do not use Chinese characters or bilingual captions.',
    'If a title is included, use "Fugu Great Wall Guardian". Output one finished design, not a website interface.'
  ].filter(Boolean).join('\n');
}

export function generationSize(type) {
  type=normalizeDesignType(type);
  return type === 'Phone wallpaper' || type === 'Bookmark' ? '1024x1536' : type === 'Postcard' ? '1536x1024' : '1024x1024';
}

export async function request(path, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort',abort,{once:true});
  const timeout = setTimeout(abort,options.timeout || 30000);
  const {body,signal,timeout:ignored,...rest} = options;
  const isForm = body instanceof FormData;
  try {
    const response = await fetch(API_BASE + path,{
      ...rest,method:options.method || (body ? 'POST' : 'GET'),signal:controller.signal,
      headers:{...(!isForm && body ? {'Content-Type':'application/json'} : {}),...options.headers},
      body:body ? isForm ? body : JSON.stringify(body) : undefined
    });
    if (response.status === 429) throw new Error('Too many generation requests. Wait a minute and try again.');
    let payload;
    try { payload = await response.json(); } catch { throw new Error('Unexpected service response (HTTP ' + response.status + '). Try again later.'); }
    if (!response.ok || !payload.ok) {
      console.warn('Great Wall service error',{path,status:response.status,error:payload.error});
      const error=new Error(serviceErrorMessage(payload.error,response.status));error.status=response.status;
      throw error;
    }
    return path === '/health' ? payload : payload.data;
  } catch(error) {
    if (signal?.aborted) throw new DOMException('Waiting stopped','AbortError');
    if (error.name === 'AbortError') throw new Error('The request timed out. Try again later.');
    if (error instanceof TypeError) throw new Error('Cannot connect to the Great Wall service. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort',abort);
  }
}
