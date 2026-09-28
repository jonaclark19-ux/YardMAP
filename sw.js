const CACHE="tarter-yard-map-v4";
// "/index.html" is not listed: with cleanUrls on, Vercel redirects it to "/",
// and a redirected response cannot be served for a navigation.
const SHELL=["/","/manifest.webmanifest","/icons/icon-192.png","/icons/icon-512.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET") return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return;
  if(url.pathname.startsWith("/api/")){
    event.respondWith(fetch(req).catch(()=>caches.match(req)));
    return;
  }
  // Network first, cache as the offline fallback. Only good answers are
  // stored: caching a 404 or 500 would serve that error offline forever.
  event.respondWith(fetch(req).then(res=>{
    if(res.ok&&res.type==="basic"&&!res.redirected){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));}
    return res;
  }).catch(()=>caches.match(req).then(r=>r||(req.mode==="navigate"?caches.match("/"):Response.error()))));
});
