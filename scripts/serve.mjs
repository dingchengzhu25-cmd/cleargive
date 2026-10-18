import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleApi } from '../dist/_worker.js';
const root = path.resolve('dist');
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('Run pnpm build first.'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end('Invalid URL'); }
  if (pathname.startsWith('/api/')) {
    try {
      const chunks=[];let length=0;
      for await (const chunk of req) { length+=chunk.length;if(length>600000){res.writeHead(413);return res.end('Request too large');}chunks.push(chunk); }
      const options={method:req.method,headers:req.headers};if(!['GET','HEAD'].includes(req.method))options.body=Buffer.concat(chunks);
      const origin=`http://${req.headers.host}`;
      const request=new Request(origin+req.url,options);
      const response=await handleApi(request,process.env);
      res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'API request failed.'})); }
  }
  const route = pathname === '/' ? '/index.html' : pathname === '/demo' ? '/demo.html' : pathname;
  const file = path.resolve(root, `.${route}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(data); });
});
server.on('error', error => { console.error(error.code==='EADDRINUSE'?'Port is already in use. Stop the existing preview or set PORT=4174.':error.message);process.exit(1); });
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`ClearGive running at http://127.0.0.1:${server.address().port}`));
