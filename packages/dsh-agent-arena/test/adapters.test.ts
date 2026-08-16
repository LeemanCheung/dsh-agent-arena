import { describe, expect, it } from 'vitest'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { GitWorktreeExecutor, type DshAgentRunner } from '../src/adapters.js'

type Reply={output?:string;lossy?:boolean;code?:number}
function fakeRuntime(replies:Reply[],calls:string[][]):SubprocessRuntime{
  return {spawn(options:{argv:string[]}){calls.push(options.argv);const reply=replies.shift()??{};const stream={readFrom:()=>({text:reply.output??'',lossy:reply.lossy??false})};return {done:Promise.resolve({exitCode:reply.code??0}),collected:{stdout:stream,stderr:{readFrom:()=>({text:'',lossy:false})}}}}} as unknown as SubprocessRuntime
}

describe('GitWorktreeExecutor patch collection',()=>{
  it('collects staged, unstaged, and intent-to-add changes relative to HEAD',async()=>{
    const calls:string[][]=[]
    const executor=new GitWorktreeExecutor(fakeRuntime([{},{output:'patch'},{output:'src/a.ts\nsrc/new.ts\n'}],calls),{} as DshAgentRunner)
    await expect(executor.diff('worktree')).resolves.toEqual({diff:'patch',changedFiles:['src/a.ts','src/new.ts']})
    expect(calls).toEqual([
      ['git','add','-N','--','.'],
      ['git','diff','HEAD','--no-ext-diff','--binary'],
      ['git','diff','HEAD','--name-only'],
    ])
  })

  it('rejects truncated patches before review or application',async()=>{
    const review=new GitWorktreeExecutor(fakeRuntime([{},{output:'partial',lossy:true},{output:'src/a.ts\n'}],[]),{} as DshAgentRunner)
    await expect(review.diff('worktree')).rejects.toThrow('exceeds the 1 MB Arena review limit')

    const apply=new GitWorktreeExecutor(fakeRuntime([{output:'partial',lossy:true}],[]),{} as DshAgentRunner)
    await expect(apply.apply('repository','worktree')).rejects.toThrow('exceeds the 1 MB Arena apply limit')
  })
})
