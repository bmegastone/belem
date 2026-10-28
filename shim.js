/* Chantier Belém — couche autonome : connexion Supabase + API window.claude utilisée par les pages.
   Mode : window.SHIM_MODE = 'chantier' | 'fin'. Configuration : window.BELEM_CONFIG = {url, anonKey}. */
(() => {
'use strict';
const CFG = window.BELEM_CONFIG || {};
const MODE = window.SHIM_MODE || 'chantier';
const L = (() => { try { return localStorage.getItem('belem.lang') === 'pt' ? 'pt' : 'fr'; } catch (e) { return 'fr'; } })();
const TX = {
  fr:{title:'Chantier Belém',login:'Se connecter',signup:'Créer un compte',email:'E-mail',password:'Mot de passe',name:'Nom et prénom',
      toSignup:'Pas encore de compte ? Créer un compte',toLogin:'Déjà un compte ? Se connecter',forgot:'Mot de passe oublié',
      sent:'Un e-mail de réinitialisation a été envoyé.',err:'Connexion impossible : vérifiez l\'e-mail et le mot de passe.',errSignup:'Inscription impossible : ',
      created:'Compte créé. Connectez-vous.',logout:'Se déconnecter',cfg:'Application non configurée : renseignez config.js (adresse et clé Supabase).',
      newPass:'Nouveau mot de passe',setPass:'Enregistrer le mot de passe',min:'6 caractères minimum'},
  pt:{title:'Obra Belém',login:'Entrar',signup:'Criar conta',email:'E-mail',password:'Palavra-passe',name:'Nome',
      toSignup:'Ainda não tem conta? Criar conta',toLogin:'Já tem conta? Entrar',forgot:'Esqueci a palavra-passe',
      sent:'Foi enviado um e-mail de reposição.',err:'Não foi possível entrar: verifique o e-mail e a palavra-passe.',errSignup:'Não foi possível criar a conta: ',
      created:'Conta criada. Entre.',logout:'Sair',cfg:'Aplicação não configurada: preencha config.js (endereço e chave Supabase).',
      newPass:'Nova palavra-passe',setPass:'Guardar a palavra-passe',min:'6 caracteres no mínimo'}
}[L];

let sb = null, session = null, me = null, adminId = null;
const listeners = new Set();
let refreshTimer = null;

// ---------- connexion ----------
const css = `.bl-ov{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;background:#20262b}
.bl-card{background:#fff;color:#1d2226;border-radius:10px;padding:24px;width:min(380px,100%);font:15px system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;gap:12px}
.bl-card h1{font:700 26px "Barlow Condensed","Arial Narrow",Arial,sans-serif;margin:0}
.bl-card label{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#5f676c;display:flex;flex-direction:column;gap:4px}
.bl-card input{font-size:16px;padding:9px 10px;border:1px solid #d6d9d2;border-radius:6px}
.bl-card button{font:600 15px system-ui,sans-serif;padding:10px;border-radius:6px;border:0;background:#1f5aa6;color:#fff;cursor:pointer}
.bl-card .lnk{background:none;color:#1f5aa6;padding:0;font-weight:500;text-align:left}
.bl-card .msg{font-size:14px;color:#b3261e;min-height:1em}
.bl-card .ok{color:#2e7d4f}
.bl-out{position:fixed;right:max(12px,env(safe-area-inset-right,0px));top:calc(10px + env(safe-area-inset-top,0px));z-index:50;font:600 12px system-ui,sans-serif;padding:5px 10px;border-radius:6px;border:1px solid #8c969d;background:#20262bcc;color:#fff;cursor:pointer}`;
function addCss(){ const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }
function overlay(html){ let o = document.querySelector('.bl-ov'); if (!o) { o = document.createElement('div'); o.className = 'bl-ov'; document.body.appendChild(o); } o.innerHTML = `<div class="bl-card">${html}</div>`; return o; }
function authScreen(){
  return new Promise(resolve => {
    let mode = 'login';
    const draw = (msg, ok) => {
      const o = overlay(`<h1>${TX.title}</h1>
        <form id="bl-f" style="display:flex;flex-direction:column;gap:12px">
          ${mode === 'signup' ? `<label>${TX.name}<input name="name" autocomplete="name" required></label>` : ''}
          <label>${TX.email}<input name="email" type="email" autocomplete="email" required></label>
          <label>${TX.password}<input name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="6" required></label>
          <button type="submit">${mode === 'signup' ? TX.signup : TX.login}</button>
        </form>
        <div class="msg ${ok ? 'ok' : ''}" role="status"></div>
        <button class="lnk" type="button" id="bl-sw">${mode === 'signup' ? TX.toLogin : TX.toSignup}</button>
        ${mode === 'login' ? `<button class="lnk" type="button" id="bl-fg">${TX.forgot}</button>` : ''}`);
      o.querySelector('.msg').textContent = msg || '';
      o.querySelector('#bl-sw').onclick = () => { mode = mode === 'login' ? 'signup' : 'login'; draw(); };
      const fg = o.querySelector('#bl-fg');
      if (fg) fg.onclick = async () => { const em = o.querySelector('[name=email]').value.trim(); if (!em) { o.querySelector('[name=email]').focus(); return; } await sb.auth.resetPasswordForEmail(em, {redirectTo:location.href.split('#')[0]}); draw(TX.sent, true); };
      o.querySelector('#bl-f').onsubmit = async e => {
        e.preventDefault(); const f = e.target.elements;
        const email = f.email.value.trim(), password = f.password.value;
        if (mode === 'signup') {
          const r = await sb.auth.signUp({email, password, options:{data:{name:f.name.value.trim()}}});
          if (r.error) { draw(TX.errSignup + r.error.message); return; }
          if (r.data.session) { session = r.data.session; o.remove(); resolve(); return; }
          mode = 'login'; draw(TX.created, true); return;
        }
        const r = await sb.auth.signInWithPassword({email, password});
        if (r.error) { draw(TX.err); return; }
        session = r.data.session; o.remove(); resolve();
      };
      o.querySelector('input').focus();
    };
    draw();
  });
}
function recoveryScreen(){
  return new Promise(resolve => {
    const o = overlay(`<h1>${TX.newPass}</h1><form id="bl-r" style="display:flex;flex-direction:column;gap:12px"><label>${TX.newPass}<input name="p" type="password" minlength="6" required autocomplete="new-password"></label><button type="submit">${TX.setPass}</button></form><div class="msg" role="status">${TX.min}</div>`);
    o.querySelector('#bl-r').onsubmit = async e => { e.preventDefault(); const r = await sb.auth.updateUser({password:e.target.elements.p.value}); if (r.error) { o.querySelector('.msg').textContent = r.error.message; return; } o.remove(); resolve(); };
  });
}
async function ensureSession(){
  addCss();
  if (!CFG.url || !CFG.anonKey || !window.supabase) { overlay(`<h1>${TX.title}</h1><p>${TX.cfg}</p>`); throw new Error('config'); }
  sb = window.supabase.createClient(CFG.url, CFG.anonKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
  let recovering = false;
  sb.auth.onAuthStateChange((ev, s) => { if (ev === 'PASSWORD_RECOVERY') recovering = true; if (ev === 'SIGNED_OUT') location.reload(); if (s) session = s; });
  const r = await sb.auth.getSession(); session = r.data.session;
  await new Promise(res => setTimeout(res, 50));
  if (recovering || /type=recovery/.test(location.hash)) await recoveryScreen();
  if (!session) await authScreen();
  const out = document.createElement('button'); out.className = 'bl-out'; out.type = 'button'; out.textContent = TX.logout;
  out.onclick = () => sb.auth.signOut(); document.body.appendChild(out);
  await loadMe();
}
async function loadMe(){
  const uid = session.user.id;
  const r = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  me = r.data || {id:uid, role:'pending', approved:false, name:'', email:session.user.email};
  const a = await sb.rpc('admin_id'); adminId = a.data || null;
}
const ready = (async () => { await new Promise(r => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r) : r()); await ensureSession(); })();

// ---------- utilitaires ----------
const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const avatar = (n, c) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="${c}"/><text x="32" y="41" font-family="Arial" font-size="24" fill="#fff" text-anchor="middle">${initials(n).replace(/[<&>]/g, '')}</text></svg>`);
const colorOf = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 45% 42%)`; };
const rid = () => { const a = new Uint8Array(10); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
const hex32 = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
const resolveKey = k => k === 'owner' ? adminId : k;
function bump(){ clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshAll, 250); }
async function refreshAll(){ for (const l of listeners) { try { await l.fetch(); } catch (e) { console.warn(e); } } }
setInterval(() => { if (document.visibilityState === 'visible') refreshAll(); }, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAll(); });
const snapDoc = (id, data) => ({id, exists:!!data, data:() => data, metadata:{fromCache:false, hasPendingWrites:false}});

// route d'une collection (chemin à nombre impair de segments)
function route(path){
  const p = path.split('/');
  if (p.length === 3 && ['pub','subs','granted'].includes(p[0])) {
    const table = p[0] === 'pub' ? 'pub' : p[0] === 'subs' ? 'priv' : 'granted';
    return {kind:'row', table, keyCol: table === 'granted' ? 'member' : 'author', key: () => resolveKey(p[1])};
  }
  if (p.length === 1) {
    if (MODE === 'fin') return {kind:'kv', table:'fin', name:p[0]};
    if (p[0] === 'members') return {kind:'members'};
    if (p[0] === 'joins') return {kind:'joins'};
    return {kind:'kv', table:'shared', name:p[0]};
  }
  throw new TypeError('chemin non pris en charge : ' + path);
}
async function listRows(rt){
  if (rt.kind === 'row') {
    const key = rt.key(); if (!key) return [];
    const r = await sb.from(rt.table).select('id,kind,data').eq(rt.keyCol, key);
    if (r.error) throw r.error;
    return r.data.map(x => ({id:x.id, data:{...(x.data || {}), ...(x.kind ? {kind:x.kind} : {})}}));
  }
  if (rt.kind === 'kv') {
    const r = await sb.from(rt.table).select('id,data').eq('kind', rt.name);
    if (r.error) throw r.error;
    return r.data.map(x => ({id:x.id, data:x.data || {}}));
  }
  if (rt.kind === 'members') {
    const r = await sb.from('profiles').select('id,company,role,lots,phone,name').eq('approved', true).neq('role', 'admin');
    if (r.error) throw r.error;
    return r.data.map(x => ({id:x.id, data:{company:x.company, role:x.role, lots:x.lots || [], phone:x.phone}}));
  }
  if (rt.kind === 'joins') {
    const r = await sb.from('profiles').select('id,company,req_role,phone,req_note').eq('requested', true).eq('approved', false);
    if (r.error) throw r.error;
    return r.data.map(x => ({id:x.id, data:{company:x.company, role:x.req_role, phone:x.phone, note:x.req_note}}));
  }
  return [];
}
async function getOne(rt, id){
  if (rt.kind === 'joins') { const r = await sb.from('profiles').select('company,req_role,phone,req_note,requested,approved').eq('id', id).maybeSingle(); const x = r.data; return x && x.requested && !x.approved ? {company:x.company, role:x.req_role, phone:x.phone, note:x.req_note} : undefined; }
  if (rt.kind === 'kv') { const r = await sb.from(rt.table).select('data').eq('kind', rt.name).eq('id', id).maybeSingle(); if (r.error) throw r.error; return r.data ? (r.data.data || {}) : undefined; }
  return (await listRows(rt)).find(x => x.id === id)?.data;
}
async function writeDoc(rt, id, data, merge){
  if (rt.kind === 'row') {
    const key = rt.key();
    let full = data;
    if (merge) { const cur = await getOne(rt, id); if (!cur) throw {code:'invalid_argument'}; full = {...cur, ...data}; }
    const row = {[rt.keyCol]:key, id, kind:full.kind || null, data:full, updated_at:new Date().toISOString()};
    const r = await sb.from(rt.table).upsert(row, {onConflict:rt.keyCol + ',id'});
    if (r.error) throw {code:'invalid_argument', message:r.error.message};
  } else if (rt.kind === 'kv') {
    let full = data;
    if (merge) { const cur = await getOne(rt, id); if (!cur) throw {code:'invalid_argument'}; full = {...cur, ...data}; }
    const r = await sb.from(rt.table).upsert({kind:rt.name, id, data:full, updated_at:new Date().toISOString()}, {onConflict:'kind,id'});
    if (r.error) throw {code:'invalid_argument', message:r.error.message};
  } else if (rt.kind === 'members') {
    const r = await sb.from('profiles').update({company:data.company ?? '', role:data.role || 'entrepreneur', lots:data.lots || [], phone:data.phone ?? '', approved:true, requested:false}).eq('id', id);
    if (r.error) throw {code:'invalid_argument', message:r.error.message};
  } else if (rt.kind === 'joins') {
    const r = await sb.from('profiles').update({company:data.company ?? '', phone:data.phone ?? '', req_role:data.role || '', req_note:data.note || '', requested:true}).eq('id', id);
    if (r.error) throw {code:'invalid_argument', message:r.error.message};
  }
  bump();
}
async function deleteDoc(rt, id){
  let r;
  if (rt.kind === 'row') r = await sb.from(rt.table).delete().eq(rt.keyCol, rt.key()).eq('id', id);
  else if (rt.kind === 'kv') r = await sb.from(rt.table).delete().eq('kind', rt.name).eq('id', id);
  else if (rt.kind === 'members') r = await sb.from('profiles').update({approved:false, role:'pending', requested:false}).eq('id', id);
  else if (rt.kind === 'joins') r = await sb.from('profiles').update({requested:false}).eq('id', id);
  if (r && r.error) throw {code:'invalid_argument', message:r.error.message};
  bump();
}
function docRef(rt, id){
  return {
    id,
    get: async () => snapDoc(id, await getOne(rt, id)),
    set: data => writeDoc(rt, id, JSON.parse(JSON.stringify(data)), false),
    update: data => writeDoc(rt, id, JSON.parse(JSON.stringify(data)), true),
    delete: () => deleteDoc(rt, id),
    onSnapshot(next, err){
      const l = {fetch: async () => { try { next(snapDoc(id, await getOne(rt, id))); } catch (e) { err && err({code:'unavailable', message:String(e.message || e)}); } }};
      listeners.add(l); l.fetch(); return () => listeners.delete(l);
    },
    collection(sub){ throw new TypeError('sous-collection non prise en charge'); }
  };
}
function collRef(path){
  const rt = route(path);
  return {
    path,
    doc: id => docRef(rt, id || rid()),
    add: async data => { const id = rid(); await writeDoc(rt, id, data, false); return docRef(rt, id); },
    get: async () => { const rows = await listRows(rt); const docs = rows.map(x => snapDoc(x.id, x.data)); return {docs, size:docs.length, empty:!docs.length}; },
    onSnapshot(next, err){
      const l = {fetch: async () => { try { const rows = await listRows(rt); const docs = rows.map(x => snapDoc(x.id, x.data)); next({docs, size:docs.length, empty:!docs.length, docChanges:() => [], metadata:{}}); } catch (e) { err && err({code:'unavailable', message:String(e.message || e)}); } }};
      listeners.add(l); l.fetch(); return () => listeners.delete(l);
    }
  };
}
const db = {
  collection: path => collRef(path),
  doc(path){
    const p = path.split('/'); const id = p.pop(); const col = p.join('/');
    if (col === 'joins') return docRef({kind:'joins'}, id);
    return docRef(route(col), id);
  }
};
// ---------- fichiers ----------
const urlCache = {}, pending = new Set();
let urlTimer = null;
window.belemFileUrl = id => {
  if (!/^[0-9a-f]{32}$/.test(String(id || ''))) return null;
  const c = urlCache[id];
  if (c && c.exp > Date.now()) return c.url;
  if (!pending.has(id)) { pending.add(id); clearTimeout(urlTimer); urlTimer = setTimeout(fetchUrls, 30); }
  return c ? c.url : null;
};
async function fetchUrls(){
  const ids = [...pending]; pending.clear(); if (!ids.length || !sb) return;
  const r = await sb.storage.from('chantier').createSignedUrls(ids.map(i => 'files/' + i), 3600);
  (r.data || []).forEach((x, i) => { if (x.signedUrl) urlCache[ids[i]] = {url:x.signedUrl, exp:Date.now() + 50 * 60 * 1000}; });
  window.dispatchEvent(new Event('belem:urls'));
}
const assets = {
  async upload(file, opts){
    const id = hex32();
    const type = (opts && opts.type) || file.type || 'application/octet-stream';
    const r = await sb.storage.from('chantier').upload('files/' + id, file, {contentType:type, upsert:false});
    if (r.error) throw {code:'upstream_error', message:r.error.message};
    return {id, url:'', sizeBytes:file.size, contentType:type};
  },
  async list(){ return {assets:[], usage:{}}; },
  async delete(ref){ await sb.storage.from('chantier').remove(['files/' + ref]); return {deleted:true}; }
};
const downloads = {
  async save({filename, data}){
    const blob = data instanceof Blob ? data : new Blob([data], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
};

// ---------- identité ----------
const profCache = {};
const user = {
  async me(){ const n = me.name || session.user.email || ''; return {id:me.id, name:me.name || (session.user.email || '').split('@')[0], avatarUrl:avatar(n, colorOf(me.id)), color:colorOf(me.id), email:me.email, isOwner:me.role === 'admin' && me.approved, canEdit:me.role === 'admin' && me.approved}; },
  async id(){ return me.id; },
  async isOwner(){ return me.role === 'admin' && me.approved; },
  async canEdit(){ return me.role === 'admin' && me.approved; },
  async can(){ return true; },
  async name(){ return me.name || ''; },
  async profiles(ids){
    ids = [...new Set([].concat(ids || []))].filter(Boolean);
    const miss = ids.filter(i => !profCache[i]);
    if (miss.length) {
      const r = await sb.from('profiles').select('id,name,email').in('id', miss);
      (r.data || []).forEach(p => { profCache[p.id] = p; });
      miss.forEach(i => { profCache[i] = profCache[i] || {id:i, name:''}; });
    }
    return Object.fromEntries(ids.map(i => { const p = profCache[i]; const n = p.name || (p.email ? p.email.split('@')[0] : ''); return [i, {id:i, name:n, avatarUrl:avatar(n, colorOf(i)), color:colorOf(i), email:p.email || null, isMe:i === me.id, guest:false}]; }));
  },
  async search(){ return []; }
};

window.claude = {
  use: async name => {
    await ready;
    if (name === 'db') return db;
    if (name === 'user') return user;
    if (name === 'assets') return me.approved ? assets : null;
    if (name === 'downloads') return downloads;
    return null;
  }
};
})();
