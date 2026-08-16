import type { Context } from '@deepseek-ai/cordis'
export declare const inject: readonly string[]
export declare function apply(ctx: Context): void | Promise<void | (() => void | Promise<void>)>
