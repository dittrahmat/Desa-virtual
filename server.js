const http=require('http'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000,DATA=process.env.DATA_FILE||path.join(__dirname,'data.json'),ADMIN=process.env.ADMIN_TOKEN||'',MAXW=300;
let warga={};try{warga=JSON.parse(fs.readFileSync(DATA,'utf8'))}catch(e){}
const clients=new Set(),ipJoin={};
const save=()=>{try{fs.writeFileSync(DATA,JSON.stringify(warga))}catch(e){console.error(e)}};
const push=()=>{const m='data: '+JSON.stringify(warga)+'\n\n';for(const r of clients)r.write(m)};
const s=(v,n)=>String(v==null?'':v).replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,n);
const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj))};
http.createServer((req,res)=>{
 const url=req.url.split('?')[0];
 if(req.method=='GET'&&url=='/events'){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write('retry: 3000\n\ndata: '+JSON.stringify(warga)+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return}
 if(req.method=='POST'&&url=='/join'){
  let b='';req.on('data',c=>{b+=c;if(b.length>4000)req.destroy()});
  req.on('end',()=>{
   let j;try{j=JSON.parse(b)}catch(e){return send(res,400,{error:'data tidak valid'})}
   const id=s(j.id,40).replace(/[^\w-]/g,''),nama=s(j.nama,24),usia=Math.round(+j.usia),hobi=s(j.hobi,30),pekerjaan=s(j.pekerjaan,30);
   if(!id||!nama||!hobi||!pekerjaan||!(usia>=1&&usia<=110))return send(res,400,{error:'isi semua kolom KTP dengan benar'});
   if(warga[id])return send(res,409,{error:'Anda sudah menjadi warga'});
   if(Object.keys(warga).length>=MAXW)return send(res,403,{error:'desa sudah penuh'});
   const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim(),now=Date.now();
   ipJoin[ip]=(ipJoin[ip]||[]).filter(t=>now-t<864e5);
   if(ipJoin[ip].length>=3)return send(res,429,{error:'terlalu banyak pendaftaran dari jaringan ini, coba lagi besok'});
   ipJoin[ip].push(now);
   const gender=j.gender=='P'?'P':'L',used=new Set(Object.values(warga).map(w=>w.slot));let slot=0;while(used.has(slot))slot++;
   warga[id]={nama,usia,hobi,pekerjaan,gender,tgl:now,slot,rumah:s(j.rumah,30)||'Rumah '+(gender=='L'?'Pak ':'Bu ')+nama.split(' ')[0]};
   save();push();send(res,200,warga[id])});return}
 if(req.method=='DELETE'&&url.startsWith('/warga/')&&ADMIN&&req.headers.authorization=='Bearer '+ADMIN){
  delete warga[decodeURIComponent(url.slice(7))];save();push();return send(res,200,{ok:1})}
 if(req.method=='GET'&&(url=='/'||url=='/index.html')){
  fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{if(e){res.writeHead(500);return res.end('index.html tidak ditemukan')}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(d)});return}
 res.writeHead(404);res.end('Tidak ditemukan')
}).listen(PORT,()=>console.log('Desa Harapan Jaya berjalan di http://localhost:'+PORT));
setInterval(()=>{for(const r of clients)r.write(': ping\n\n')},25000);
