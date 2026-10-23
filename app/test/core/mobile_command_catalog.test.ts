import test from 'node:test';import assert from 'node:assert/strict';
import {MOBILE_COMMANDS,buildMobileCommand} from '../../src/core/mobile_command_catalog.js';
test('graphical catalog covers original public command families with structured arguments',()=>{
  const expected=['helps','status','usage','login','stop','review','skills','plugins','apps','mcp','use','automation','weibo','new','uploads','assistant','log','todo','remind','note','provider','models','model','plan','experimental','compact','goal','personality','instructions','fast','threads','search','next','prev','open','peek','rename','permissions','allow','deny','reconnect','retry','restart','lang'];
  const found=new Set(MOBILE_COMMANDS.map(x=>x.template.split(/\s/)[0].slice(1)));
  for(const command of expected)assert.ok(found.has(command),'missing graphical family '+command);
  assert.equal(new Set(MOBILE_COMMANDS.map(x=>x.id)).size,MOBILE_COMMANDS.length);
  for(const action of MOBILE_COMMANDS){const values=Object.fromEntries(action.fields.map(f=>[f.key,f.options?.[0]||'sample']));const built=buildMobileCommand(action.id,values);assert.ok(built.text.startsWith('/'));assert.ok(!/\{\w+\}/.test(built.text));}
  assert.throws(()=>buildMobileCommand('arbitrary-shell',{text:'whoami'}),/未知/);
  assert.throws(()=>buildMobileCommand('permissions-set',{value:'bypass'}),/选项/);
  assert.throws(()=>buildMobileCommand('instructions-set',{}),/请填写/);
  assert.equal(buildMobileCommand('plan-set',{value:'on',rawCommand:'/restart'}).text,'/plan on');
});
