import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),ui=path.join(root,'apps/mobile-ui'),modules=path.join(ui,'node_modules'),vendor=path.join(ui,'vendor');
fs.mkdirSync(vendor,{recursive:true});
for(const [source,dest] of [['marked/lib/marked.umd.js','marked.js'],['dompurify/dist/purify.min.js','purify.js'],['katex/dist/katex.min.js','katex.js'],['katex/dist/katex.min.css','katex.css']])fs.copyFileSync(path.join(modules,source),path.join(vendor,dest));
fs.cpSync(path.join(modules,'katex/dist/fonts'),path.join(vendor,'fonts'),{recursive:true});
let notices='Bundled offline rendering libraries\n\n';
for(const name of ['marked','dompurify','katex']){const pkg=JSON.parse(fs.readFileSync(path.join(modules,name,'package.json'),'utf8'));const license=['LICENSE','LICENSE.md','LICENSE.txt'].find(f=>fs.existsSync(path.join(modules,name,f)));notices+=`${name} ${pkg.version}\n${license?fs.readFileSync(path.join(modules,name,license),'utf8'):'See package license.'}\n\n`;}
fs.writeFileSync(path.join(vendor,'LICENSES.txt'),notices);
export function copyMobileAssets(destination){fs.mkdirSync(destination,{recursive:true});for(const name of ['index.html','style.css','app.js','controls.js','render.js','vendor'])fs.cpSync(path.join(ui,name),path.join(destination,name),{recursive:true});}
copyMobileAssets(path.join(root,'apps/web/public/mobile'));
fs.copyFileSync(path.join(ui,'preview.html'),path.join(root,'apps/web/public/mobile/preview.html'));
