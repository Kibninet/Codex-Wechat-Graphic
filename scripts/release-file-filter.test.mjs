import test from 'node:test';import assert from 'node:assert/strict';import {includeAppSource} from './release-file-filter.mjs';
test('Windows packaging omits nested web secrets and Android signing files while preserving sources',()=>{
  for(const file of ['.env.local','apps/web/.env.local','apps/web/.next/server/page.js','apps/mobile-ui/node_modules/marked/index.js','apps/android/signing/password.txt','apps/android/release.jks','apps/android/build/classes.dex'])assert.equal(includeAppSource(file),false,file);
  for(const file of ['src/runtime/weixin_mobile_control.ts','apps/mobile-ui/vendor/katex.js','apps/web/server/mobile-tasks.ts','apps/android/src/app/codexwechat/mobile/MainActivity.java'])assert.equal(includeAppSource(file),true,file);
});
