import { randomUUID } from 'node:crypto';
import type { Store, Query } from './db.ts';
import { requireThat } from './domain.ts';

export const maxImageBytes = 5 * 1024 * 1024;
const day = 24 * 3600000;
const mimeTypes = {png:'image/png', jpg:'image/jpeg', gif:'image/gif', webp:'image/webp'};

function imageType(b: Buffer) {
  if (b.length >= 24 && b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) && b.toString('ascii',12,16)==='IHDR') return 'png';
  if (b.length >= 10 && ['GIF87a','GIF89a'].includes(b.toString('ascii',0,6))) return 'gif';
  if (b.length >= 12 && b[0]===255 && b[1]===216 && b[2]===255) return 'jpg';
  if (b.length >= 20 && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP' && ['VP8 ','VP8L','VP8X'].includes(b.toString('ascii',12,16))) return 'webp';
}
export async function saveImage(db: Store, owner: string, bytes: Buffer, origin: string) {
  requireThat(bytes.length <= maxImageBytes, 413, 'Choose an image of 5 MiB or less.');
  const ext=imageType(bytes);
  requireThat(ext,415,'Choose a PNG, JPEG, WebP or GIF file.');
  const id=randomUUID()+'.'+ext;
  await db.transaction(async q=>{
    if (db.dialect==='postgres') await q('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);
    await q('DELETE FROM pc_images WHERE owner_id=$1 AND attached=0 AND created_ms<$2',[owner, Date.now()-day]);
    const [usage]=await q('SELECT COALESCE(SUM(size),0) AS total FROM pc_images WHERE owner_id=$1 AND attached=0',[owner]);
    requireThat(Number(usage.total)+bytes.length<=8*maxImageBytes,429,'Finish submitting your existing uploads before adding more.');
    await q('INSERT INTO pc_images (id,owner_id,mime,bytes,size,created_ms) VALUES($1,$2,$3,$4,$5,$6)',[id,owner,mimeTypes[ext],bytes,bytes.length,Date.now()]);
  });
  return new URL('/media/'+id,origin).href;
}
export async function attachImage(q: Query, value: unknown, service: string, owner: string) {
  if(typeof value!=='string' || !value || !service) return;
  const u=new URL(value,service);
  if(u.origin!==service || !u.pathname.startsWith('/media/')) return;
  const file=mediaPath.exec(u.pathname);
  requireThat(file,400,'Invalid uploaded image address.');
  const rows=await q('UPDATE pc_images SET attached=1 WHERE id=$1 AND (owner_id=$2 OR attached=1) RETURNING id',[file[1],owner]);
  requireThat(rows.length,400,'That upload is unavailable. Choose the image file again.');
}
export const mediaPath=/^\/media\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))$/;
