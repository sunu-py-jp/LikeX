import { build } from 'esbuild';
export async function load(entry = 'model-entry', { mockContextMenu = false } = {}) {
 const output = await build({ entryPoints: [new URL(`../src/${entry}.ts`,import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,
 plugins:[{name:'source-core-and-react',setup(builder){
  if(mockContextMenu){
   builder.onResolve({filter:/^@likex\/core\/browser$/},()=>({path:'menu-test',namespace:'menu-test'}));
   builder.onLoad({filter:/.*/,namespace:'menu-test'},()=>({contents:'export function openContextMenu(options) { const record = {...options, closed:false}; (globalThis.__likexContextMenus ??= []).push(record); return () => { record.closed = true; options.onClose?.(); }; }',loader:'js'}));
  }
  builder.onResolve({filter:/^@likex\/core(\/json)?$/},({path})=>({path:new URL(path.endsWith('/json')?'../../core/src/json.ts':'../../core/src/index.ts',import.meta.url).pathname}));
  builder.onResolve({filter:/^(react|react-dom|lucide-react)(\/.*)?$/},({path})=>({path:import.meta.resolve(path),external:true}));
 }}]});
 return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
export const deferred = () => { let resolve,reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
