/** Hand-authored tool programs; never import the task pack or its expected data. */
export const promptPrefixes = [
  ['single', 'In account.txt change status=pending'], ['repeated', 'In records.txt'],
  ['multi', 'Change both pending statuses'], ['consecutive', 'In sequence.txt first insert'],
  ['drift', 'Read account.txt before editing.'], ['unrelated-long', 'In mixed.txt'],
  ['target-long', 'In long.txt'], ['snapshot-limit', 'In large.txt'],
  ['rewrite', 'Rewrite routes.txt'], ['satisfied', 'Verify account.txt'],
  ['create', 'Create new.txt'], ['override', 'For this task I explicitly request'],
  ['generator', 'generated.txt is maintained'],
]

export function suiteProgram(id, arm, step = 0, shell = 'pwsh') {
  if (!['stock-edit', 'hashline-default', 'hashline-fallback'].includes(arm)) throw new Error('unknown suite arm')
  if (!['pwsh', 'bash'].includes(shell)) throw new Error('unknown suite shell')
  if (!promptPrefixes.some(([key]) => key === id) || !Number.isSafeInteger(step) || step < 0) throw new Error('unknown suite step')
  if (step >= (id === 'consecutive' ? 2 : 1)) return null
  const header = `const stock=${arm === 'stock-edit'};const strict=${arm === 'hashline-default'};
const change=async(file,r,patch,oldText,newText,extra={})=>stock?tools.edit({file_path:file,old_string:oldText,new_string:newText}):tools.edit({input:'['+r.path+'#'+r.tag+']\\n'+patch,...extra});
const command=async(command)=>{const r=await tools.${shell}({description:'offline suite local command',command});if(r.exitCode!==0||r.timedOut||r.aborted)throw Error('suite shell failed');return r.stdout.text;};
`
  const status = (file, line = 1) => `const r=await tools.read({file_path:${JSON.stringify(file)}});await change(${JSON.stringify(file)},r,${JSON.stringify('PUT ' + line + ':\n+status=active')},'status=pending','status=active');`
  let body
  if (id === 'single') body = status('account.txt')
  if (id === 'repeated') body = `const r=await tools.read({file_path:'records.txt'});await change('records.txt',r,'PUT 4:\\n+status=active','[second]\\nstatus=pending','[second]\\nstatus=active');`
  if (id === 'multi') body = `const a=await tools.read({file_path:'a.txt'});await change('a.txt',a,'PUT 1:\\n+left=active\\nPUT 3:\\n+right=active','left=pending\\nkeep=yes\\nright=pending','left=active\\nkeep=yes\\nright=active');const b=await tools.read({file_path:'b.txt'});await change('b.txt',b,'PUT 1:\\n+enabled=true','enabled=false','enabled=true');`
  if (id === 'consecutive') body = step === 0
    ? `const r=await tools.read({file_path:'sequence.txt'});await change('sequence.txt',r,'PUT 1:\\n+start=yes\\n+middle=ready','start=yes','start=yes\\nmiddle=ready');`
    : `const r=await tools.read({file_path:'sequence.txt'});if(!JSON.stringify(r).includes('middle=ready'))throw Error('intermediate state missing');await change('sequence.txt',r,'PUT 3:\\n+tail=active','tail=pending','tail=active');`
  if (id === 'drift') body = `const stale=await tools.read({file_path:'account.txt'});try{await change('account.txt',stale,'PUT 1:\\n+status=active','status=pending','status=active');}catch{}const fresh=await tools.read({file_path:'account.txt'});if(!JSON.stringify(fresh).includes('status=active'))await change('account.txt',fresh,'PUT 1:\\n+status=active','status=pending','status=active');`
  if (id === 'unrelated-long') body = `await tools.read({file_path:'mixed.txt',offset:1,limit:1});const r=await tools.read({file_path:'mixed.txt',offset:2,limit:1});await change('mixed.txt',r,'PUT 2:\\n+status=active','status=pending','status=active');`
  if (id === 'target-long') body = `const r=await tools.read({file_path:'long.txt'});const text=(await command(${JSON.stringify('node -p "require(\'node:fs\').readFileSync(\'long.txt\',\'utf8\')"')})).trimEnd();if(!text.endsWith(':status=pending'))throw Error('unexpected long source');const next=text.slice(0,-7)+'active';if(stock)await tools.edit({file_path:'long.txt',old_string:text,new_string:next});else if(strict)await change('long.txt',r,'PUT 1:\\n+'+next,text,next);else{const citation=/readCallId: (\\S+?)\\)/u.exec(r.nextAction??'')?.[1];await tools.edit({file_path:'long.txt',old_string:text,new_string:next,fallbacks:[{path:'long.txt',reason:'window-limit',readCallId:citation,ranges:[{startLine:1,endLine:1}]}]});}`
  if (id === 'snapshot-limit') body = `const r=await tools.read({file_path:'large.txt',offset:1,limit:1});if(strict)return 'no tag available; preserve file';const extra=stock?{}:{fallbacks:[{path:'large.txt',reason:'snapshot-limit',readCallId:/readCallId: (\\S+?)\\)/u.exec(r.nextAction??'')?.[1]}]};await tools.edit({file_path:'large.txt',old_string:'status=pending',new_string:'status=active',...extra});`
  if (id === 'rewrite') body = `const r=await tools.read({file_path:'routes.txt'});const old='version=1\\n'+Array.from({length:128},(_,i)=>'/route/'+(i+1)+'=legacy\\n').join('');const next='version=2\\n'+Array.from({length:128},(_,i)=>'/route/'+(i+1)+'=active\\n').join('');await change('routes.txt',r,'PUT 1.=129:\\n'+next.trimEnd().split('\\n').map(l=>'+'+l).join('\\n'),old,next);`
  if (id === 'satisfied') body = `const r=await tools.read({file_path:'account.txt'});if(!JSON.stringify(r).includes('status=active'))throw Error('no-op not satisfied');`
  if (id === 'create') body = `await tools.write({file_path:'new.txt',content:'created=yes\\n'});`
  if (id === 'override') body = `await tools.read({file_path:'account.txt'});if(strict)return 'replace mode unavailable';await tools.edit({file_path:'account.txt',old_string:'status=pending',new_string:'status=active',...(stock?{}:{fallbacks:[{path:'account.txt',reason:'user-override',modes:['replace'],userSource:{quote:'For this task I explicitly request replace mode with old_string/new_string for account.txt: replace status=pending with status=active, preserving owner and final LF.'}}]})});`
  if (id === 'generator') body = `await tools.read({file_path:'generated.txt'});await command('node generate.mjs');await tools.read({file_path:'generated.txt'});`
  // Templates above quote PTC string literals explicitly; normalize once for emitted code.
  return header.replaceAll('\\\\n', '\\n') + body.replaceAll('\\\\n', '\\n') + `return 'suite program complete';`
}
