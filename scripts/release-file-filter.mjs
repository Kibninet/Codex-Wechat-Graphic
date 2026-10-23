/** Keep developer credentials and nested build caches out of Windows archives. */
export function includeAppSource(relative) {
  const normalized=String(relative).replaceAll('\\','/');
  const segments=normalized.split('/');const name=segments.at(-1)||'';
  if(segments.some(x=>['node_modules','.next','.git','.apksigning'].includes(x)))return false;
  if(name==='.env'||name.startsWith('.env.')||/\.(?:tsbuildinfo|jks|keystore)$/.test(name))return false;
  if(/^apps\/android\/(?:build|signing)(?:\/|$)/.test(normalized))return false;
  return true;
}
