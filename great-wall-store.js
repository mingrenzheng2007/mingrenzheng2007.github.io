const DB_NAME = 'allen-great-wall-v1';
const STORE = 'archive';
let dbPromise;

function database() {
  if (!dbPromise) dbPromise = new Promise((resolve,reject) => {
    const req = indexedDB.open(DB_NAME,1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE,{keyPath:'id'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {dbPromise = null;reject(new Error('Cannot open your local journal. Check whether site storage is allowed.'));};
  });
  return dbPromise;
}

async function transact(mode,action) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE,mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(new Error('Local storage failed. Space may be full. Download important photos and designs first.'));
    tx.onabort = () => reject(new Error('Your journal was not saved. Check available browser storage.'));
  });
}

export async function readArchive() {
  const rows = await transact('readonly',s => s.getAll());
  return rows.sort((a,b) => b.createdAt-a.createdAt);
}

export async function saveArchive(item) {
  await transact('readwrite',s => s.put(item));
  const rows = await readArchive();
  const kind = item.kind === 'creation' ? 'creation' : 'record';
  const excess = rows.filter(x => (x.kind === 'creation' ? 'creation' : 'record') === kind).slice(kind === 'creation' ? 30 : 60);
  if (excess.length) await transact('readwrite',s => {excess.forEach(x=>s.delete(x.id));});
  return item;
}

export async function removeArchive(id) {
  await transact('readwrite',s => s.delete(id));
}

export async function imageBlob(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choose a JPG, PNG, or another image file.');
  if (file.size > 20 * 1024 * 1024) throw new Error('This photo exceeds 20 MB. Compress it first.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve,reject) => {image.onload=resolve;image.onerror=()=>reject(new Error('Cannot read this image. Try a JPG or PNG.'));image.src=url;});
    const ratio = Math.min(1,1600 / Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * ratio);
    canvas.height = Math.round(image.naturalHeight * ratio);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject) => canvas.toBlob(b=>b ? resolve(b) : reject(new Error('Image conversion failed.')),'image/jpeg',.88));
  } finally { URL.revokeObjectURL(url); }
}
