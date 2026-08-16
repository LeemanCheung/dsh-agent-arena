import type { Context } from '@deepseek-ai/cordis'

declare const LOOKUP_HOST: unique symbol
declare const LOOKUP_WIRE: unique symbol
declare const CONTEXT_WIRE: unique symbol

export interface TypertLookup<Host, Wire> {
  readonly [LOOKUP_HOST]: Host
  readonly [LOOKUP_WIRE]: Wire
}

export interface TypertContext<Wire> {
  readonly [CONTEXT_WIRE]: Wire
}

export interface TypertLookupMap {}
export interface TypertContextMap {}
export interface TypertRemoteMap {}
export interface TypertRemoteNamespaceMap {}

export interface TypertGatewayBinding<Service extends object = object> {
  readonly service: Service
  readonly serviceKey: string
  readonly namespace: string
}

export interface TypertGatewayBindingOptions {
  readonly namespace?: string
}

type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void

export abstract class TypertRemoteService<out T = never> {
  protected readonly ctx: Context
  readonly typertRemote: TypertGatewayBinding<this>

  protected constructor(ctx: Context, serviceKey: string, options: TypertGatewayBindingOptions = {}) {
    this.ctx = ctx
    this.typertRemote = { service: this, serviceKey, namespace: options.namespace ?? serviceKey }
  }
}

export function Remote<This extends object, Args extends unknown[], Result>(
  _method: (this: This, ...args: Args) => Result,
  _context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void
export function Remote(exportName: string): RemoteMethodDecorator
export function Remote<This extends object, Args extends unknown[], Result>(
  methodOrExportName: string | ((this: This, ...args: Args) => Result),
  context?: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void | RemoteMethodDecorator {
  if (typeof methodOrExportName === 'string') return () => undefined
  void context
}
