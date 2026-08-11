import { AnyRouter, inferRouterContext } from '@trpc/server';
import {
  NodeHTTPCreateContextFnOptions,
  NodeHTTPHandlerOptions,
  NodeHTTPRequest,
  NodeHTTPResponse,
  nodeHTTPRequestHandler,
} from '@trpc/server/adapters/node-http';
import { Context, Middleware } from 'koa';

declare module 'koa' {
  interface Request {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    body?: any;
  }
}
declare module 'http' {
  interface IncomingMessage {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    body?: any;
  }
}
declare module 'http2' {
  interface Http2ServerRequest {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    body?: any;
  }
}

/**
 * Options handed to `createContext`. Alongside tRPC's own `req`/`res`, this
 * includes `koaCtx` - the koa context for the request, which is where koa keeps
 * state, cookies, session and anything your other middleware attached.
 */
export type CreateTrpcKoaContextOptions = NodeHTTPCreateContextFnOptions<
  NodeHTTPRequest,
  NodeHTTPResponse
> & { koaCtx: Context };

type KoaCreateContextFn<TRouter extends AnyRouter> = (
  opts: CreateTrpcKoaContextOptions,
) => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;

// tRPC makes createContext optional only for routers that need no context.
// Mirror that rule rather than flattening it to always-optional, which would
// let a context-requiring router be mounted without one.
type KoaCreateContextOpts<TRouter extends AnyRouter> =
  object extends inferRouterContext<TRouter>
    ? { createContext?: KoaCreateContextFn<TRouter> }
    : { createContext: KoaCreateContextFn<TRouter> };

type HandlerOpts<TRouter extends AnyRouter> = NodeHTTPHandlerOptions<
  TRouter,
  NodeHTTPRequest,
  NodeHTTPResponse
>;

export type AdditionalMiddlewareOpts = { prefix?: `/${string}` };
export type CreateKoaMiddlewareOptions<TRouter extends AnyRouter> = Omit<
  HandlerOpts<TRouter>,
  'createContext'
> &
  KoaCreateContextOpts<TRouter> &
  AdditionalMiddlewareOpts;

export const createKoaMiddleware =
  <TRouter extends AnyRouter>(opts: CreateKoaMiddlewareOptions<TRouter>): Middleware =>
  async (ctx, next) => {
    // createContext sits behind a conditional type, so widen it to destructure.
    const { prefix, createContext, ...handlerOpts } = opts as Omit<
      HandlerOpts<TRouter>,
      'createContext'
    > &
      AdditionalMiddlewareOpts & { createContext?: KoaCreateContextFn<TRouter> };
    const { req, res, request } = ctx;

    // match on a path segment boundary, otherwise a prefix of `/trpc` also
    // claims sibling routes like `/trpc-admin/users` and hands tRPC a garbled
    // path instead of falling through to the rest of the koa stack.
    if (prefix && request.path !== prefix && !request.path.startsWith(`${prefix}/`)) {
      return next();
    }

    // put parsed body (by koa-bodyparser/@koa/bodyparser for example)
    // where nodeHTTPRequestHandler will look for it.
    // https://github.com/BlairCurrey/trpc-koa-adapter/issues/24
    if ('body' in request) {
      req.body = request.body;
    }

    // koa uses 404 as a default status but some logic in
    // nodeHTTPRequestHandler assumes default status of 200.
    // https://github.com/trpc/trpc/blob/abc941152b71ff2d68c63156eb5a142174779261/packages/server/src/adapters/node-http/nodeHTTPRequestHandler.ts#L63
    res.statusCode = 200;

    await nodeHTTPRequestHandler({
      ...handlerOpts,
      // wrap the caller's createContext so it also receives the koa context.
      ...(createContext && {
        createContext: (nodeOpts) => createContext({ ...nodeOpts, koaCtx: ctx }),
      }),
      req,
      res,
      path: request.path.slice((prefix?.length ?? 0) + 1),
      // the spread above satisfies the handler's conditional createContext
      // requirement, which TypeScript cannot verify through the generic.
    } as HandlerOpts<TRouter> & { req: NodeHTTPRequest; res: NodeHTTPResponse; path: string });
  };
