/* global console */
// Development stand-in for Google's tagging server: answers every request so the gateway, logs and usage can be
// tried without a GTM container. Use the sgtm compose profile for the real image.
import { createServer } from 'node:http';

createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (req.url.startsWith('/gtm.js') || req.url.startsWith('/gtag/js')) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      return res.end('/* fake gtm.js */');
    }
    res.writeHead(req.url.startsWith('/g/collect') ? 204 : 200);
    res.end();
  });
}).listen(18080, '127.0.0.1', () => console.log('fake tagging server on http://127.0.0.1:18080'));
