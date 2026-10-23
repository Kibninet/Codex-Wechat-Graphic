(() => {
  'use strict';
  const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const delimiters=[['$$','$$',true],['\\[','\\]',true],['\\(','\\)',false],['$','$',false]];
  function tokenizer(src){for(const [left,right,display] of delimiters){if(!src.startsWith(left))continue;let end=src.indexOf(right,left.length);while(end>0&&src[end-1]==='\\')end=src.indexOf(right,end+right.length);if(end<=left.length)continue;const body=src.slice(left.length,end);if(left==='$'&&(/\n/.test(body)||src[1]==='$'))continue;return {type:'cwMath',raw:src.slice(0,end+right.length),text:body,display};}}
  if(window.marked&&window.katex){marked.use({extensions:[{name:'cwMath',level:'inline',start:src=>src.search(/\$|\\[[(]/),tokenizer,renderer:token=>katex.renderToString(token.text,{displayMode:token.display,throwOnError:false,trust:false,strict:'ignore',maxExpand:1000,maxSize:20})}],renderer:{html:token=>escape(token.text)},gfm:true,breaks:false});}
  function render(element,text){
    const source=String(text||'');
    if(!window.marked||!window.DOMPurify||!window.katex){element.textContent=source;return;}
    try{element.innerHTML=DOMPurify.sanitize(marked.parse(source),{USE_PROFILES:{html:true,mathMl:true},FORBID_TAGS:['img','svg','style','iframe','form','input','button','textarea','script','object','embed'],FORBID_ATTR:['src','srcset','id','name'],ALLOW_DATA_ATTR:false});element.classList.add('rich-text');
      element.querySelectorAll('pre').forEach(pre=>{const code=pre.querySelector('code');if(!code)return;const button=document.createElement('button');button.type='button';button.className='copy-code';button.textContent='复制代码';button.onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent);button.textContent='已复制';setTimeout(()=>button.textContent='复制代码',1600);}catch{button.textContent='长按代码可复制';}};pre.prepend(button);});
      element.querySelectorAll('a').forEach(a=>{a.rel='noopener noreferrer';a.target='_blank';});
    }catch{element.textContent=source;}
  }
  window.CWRender={render};
})();
