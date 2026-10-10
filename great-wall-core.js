export const API_BASE = 'https://47.103.59.118/ai';
export const IMAGE_MODEL = 'gpt-image-2';
export const DESIGN_TYPES = ['冰箱贴', '书签', '明信片', '帆布包', '手机壁纸'];
export const KIND_LABELS = {checkin:'足迹', patrol:'巡检', story:'故事', creation:'文创'};

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
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
}

export function distanceMeters(a,b) {
  if (!a || !b) return null;
  const rad = v => Number(v) * Math.PI / 180;
  const h = Math.sin(rad(b.latitude-a.latitude)/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return Math.round(6371000 * 2 * Math.asin(Math.min(1,Math.sqrt(h))));
}

export function formatDistance(value) {
  if (value == null) return '尚未获取位置';
  return value < 1000 ? value + ' 米' : (value / 1000).toFixed(1) + ' 公里';
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
    '请生成一张完整的府谷长城文创成品设计图。',
    '主题点位：' + site.name + '。历史线索：' + site.story,
    '文创类型：' + designType + '。',
    count ? '用户提供 ' + count + ' 张参考照片。保留主体结构；多图时综合所有照片的纹理、色彩与局部元素。' : '',
    '表现府谷黄土山地、长城墩台与守护足迹，暖色清晰，适合学生和志愿者分享。',
    '不要出现真实品牌、二维码、联系方式或误导性官方标识；不要误画成北京旅游长城。',
    note ? '风格补充：' + note : '',
    '可包含“墩台志”字样。只输出一张作品，不生成网站界面。'
  ].filter(Boolean).join('\n');
}

export function generationSize(type) {
  return type === '手机壁纸' || type === '书签' ? '1024x1536' : type === '明信片' ? '1536x1024' : '1024x1024';
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
    if (response.status === 429) throw new Error('生成请求较多，请等一分钟再试。');
    let payload;
    try { payload = await response.json(); } catch { throw new Error('服务响应异常（HTTP ' + response.status + '），请稍后重试。'); }
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '请求失败（HTTP ' + response.status + '）');
    }
    return path === '/health' ? payload : payload.data;
  } catch(error) {
    if (signal?.aborted) throw new DOMException('已停止等待','AbortError');
    if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接长城服务，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort',abort);
  }
}
