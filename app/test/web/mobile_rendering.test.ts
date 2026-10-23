import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const ui=path.resolve('apps/mobile-ui');const require=createRequire(path.join(ui,'package.json'));
test('offline answer rendering formats markdown and TeX, preserves code and rejects active HTML',()=>{
  const {JSDOM}=require('jsdom');const dom=new JSDOM('<!doctype html><div id="result"></div>',{runScripts:'outside-only',url:'https://app.codexwechat.local/'});
  try{for(const file of ['vendor/marked.js','vendor/purify.js','vendor/katex.js','render.js'])dom.window.eval(fs.readFileSync(path.join(ui,file),'utf8'));
    const el=dom.window.document.getElementById('result');
    dom.window.CWRender.render(el,'## 推导\n\n**结果**：$x^2+1$，以及 \\(\\frac{a}{b}\\)。\n\n$$\\int_0^1 x^2\\,dx=\\frac13$$\n\n|变量|数值|\n|---|---|\n|x|1|\n\n```js\nconst x = "$not math$";\n```');
    assert.equal(el.querySelector('h2')?.textContent,'推导');assert.equal(el.querySelectorAll('.katex').length,3);assert.ok(el.querySelector('.katex-display'));assert.ok(el.querySelector('table'));assert.match(el.querySelector('pre code').textContent,/\$not math\$/);assert.equal(el.querySelector('pre .katex'),null);assert.ok(el.querySelector('.copy-code'));
    dom.window.CWRender.render(el,'<img src="https://private.example/secret" onerror="Native.request(1)">\n\n[bad](javascript:alert(1))\n\n$\\href{javascript:alert(1)}{bad}$\n\n$\\unknowncommand{x}$');
    assert.equal(el.querySelector('img,script,iframe,svg,form'),null);assert.equal(el.querySelector('[onerror]'),null);assert.ok(![...el.querySelectorAll('[href]')].some(x=>x.getAttribute('href').startsWith('javascript:')));assert.match(el.textContent,/unknowncommand/);
  }finally{dom.window.close();}
});

test('mobile send prevents double clicks and refreshes the original thread with rendered final history',async()=>{
  const {JSDOM}=require('jsdom');const dom=new JSDOM(fs.readFileSync(path.join(ui,'index.html'),'utf8'),{runScripts:'outside-only',url:'https://app.codexwechat.local/'});
  try{
    let sends=0,completed=false;const id='b'.repeat(32);const chat={threadId:id,title:'测试聊天',selected:true,mode:'work',settings:{},pendingFiles:[],pendingFileCount:0};
    dom.window.AbortSignal=AbortSignal;dom.window.fetch=async(url,options={})=>{let data;const p=String(url);if(p.endsWith('/threads'))data=[chat];else if(p.endsWith('/select'))data=chat;else if(p.includes('/send')){sends++;await new Promise(r=>setTimeout(r,15));completed=true;data={runId:id};}else if(p.includes('/run/'))data={state:'completed',startedAt:Date.now(),approvals:[]};else if(p.includes('/thread/'))data={thread:chat,items:completed?[{role:'assistant',text:'**已完成**：$x^2$'}]:[]};else throw new Error('unexpected '+p);return {ok:true,status:200,json:async()=>({data})};};
    for(const file of ['vendor/marked.js','vendor/purify.js','vendor/katex.js','render.js','controls.js','app.js'])dom.window.eval(fs.readFileSync(path.join(ui,file),'utf8'));
    await new Promise(r=>setTimeout(r,30));const doc=dom.window.document;doc.getElementById('composer').value='test';doc.getElementById('send').click();doc.getElementById('send').click();
    assert.equal(doc.getElementById('send').dataset.pending,'true');await new Promise(r=>setTimeout(r,100));assert.equal(sends,1);assert.ok(doc.querySelector('#messages strong'));assert.ok(doc.querySelector('#messages .katex'));assert.equal(doc.getElementById('send').disabled,false);
  }finally{dom.window.close();}
});
