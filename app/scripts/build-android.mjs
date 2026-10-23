import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyMobileAssets } from './prepare-mobile-assets.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const options=Object.fromEntries(Array.from({length:Math.floor((process.argv.length-2)/2)},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
for(const name of ['--java-home','--build-tools','--android-jar','--signing-dir','--out'])if(!options[name])throw new Error('Missing '+name);
const javaHome=path.resolve(options['--java-home']), tools=path.resolve(options['--build-tools']), androidJar=path.resolve(options['--android-jar']);
const signing=path.resolve(options['--signing-dir']), output=path.resolve(options['--out']);
const project=path.join(root,'apps/android'), sourceAssets=path.join(root,'apps/mobile-ui');
// Windows Android native tools cannot reliably open non-ASCII resource paths.
const build=fs.mkdtempSync(path.join(process.platform==='win32' ? (process.env.PUBLIC || os.tmpdir()) : os.tmpdir(),'CodexWechat-Android-'));
const assets=path.join(build,'assets');copyMobileAssets(assets);
fs.cpSync(path.join(project,'res'),path.join(build,'res'),{recursive:true});
fs.copyFileSync(path.join(project,'AndroidManifest.xml'),path.join(build,'AndroidManifest.xml'));
const classes=path.join(build,'classes'), dex=path.join(build,'dex');
for(const dir of [build,classes,dex,signing,path.dirname(output)])fs.mkdirSync(dir,{recursive:true});
const exe=name=>path.join(javaHome,'bin',name+(process.platform==='win32'?'.exe':''));
function run(file,args){const result=spawnSync(file,args,{stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(path.basename(file)+' failed: '+result.status);}
const key=path.join(signing,'codex-wechat.jks'), pass=path.join(signing,'password.txt');
if(!fs.existsSync(pass))fs.writeFileSync(pass,crypto.randomBytes(32).toString('base64url')+'\n',{mode:0o600,flag:'wx'});
if(!fs.existsSync(key))run(exe('keytool'),['-genkeypair','-keystore',key,'-storepass:file',pass,'-keypass:file',pass,'-alias','codex-wechat','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Codex-Wechat, O=Codex-Wechat','-noprompt']);
const aapt=path.join(tools,'aapt2'+(process.platform==='win32'?'.exe':''));
const compiled=path.join(build,'resources.zip'), unsigned=path.join(build,'unsigned.apk'), aligned=path.join(build,'aligned.apk');
run(aapt,['compile','--dir',path.join(build,'res'),'-o',compiled]);
const localJar=path.join(build,'android.jar');fs.copyFileSync(androidJar,localJar);
run(aapt,['link','-o',unsigned,'-I',localJar,'--manifest',path.join(build,'AndroidManifest.xml'),'-R',compiled,'-A',assets,'--min-sdk-version','26','--target-sdk-version','35']);
run(exe('javac'),['-encoding','UTF-8','--release','8','-classpath',androidJar,'-d',classes,path.join(project,'src/app/codexwechat/mobile/MainActivity.java')]);
function listClasses(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?listClasses(path.join(dir,e.name)):e.name.endsWith('.class')?[path.join(dir,e.name)]:[]);}
run(exe('java'),['-cp',path.join(tools,'lib/d8.jar'),'com.android.tools.r8.D8','--lib',androidJar,'--min-api','26','--output',dex,...listClasses(classes)]);
run(exe('jar'),['uf',unsigned,'-C',dex,'classes.dex']);
run(path.join(tools,'zipalign'+(process.platform==='win32'?'.exe':'')),['-f','4',unsigned,aligned]);
run(exe('java'),['-jar',path.join(tools,'lib/apksigner.jar'),'sign','--ks',key,'--ks-key-alias','codex-wechat','--ks-pass','file:'+pass,'--out',output,aligned]);
run(exe('java'),['-jar',path.join(tools,'lib/apksigner.jar'),'verify','--verbose',output]);
copyMobileAssets(path.join(root,'apps/web/public/mobile'));
const downloadDir=path.join(root,'apps/web/public/downloads');fs.mkdirSync(downloadDir,{recursive:true});
fs.copyFileSync(output,path.join(downloadDir,path.basename(output)));
const hash=crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(output+'.sha256',hash+'  '+path.basename(output)+'\n');
console.log(JSON.stringify({apk:output,bytes:fs.statSync(output).size,sha256:hash}));
