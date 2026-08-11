import { AnyRouter } from '@trpc/server';
import {
  NodeHTTPCreateContextFnOptions,
  NodeHTTPHandlerOptions,
  NodeHTTPRequest,
  NodeHTTPResponse,
  nodeHTTPRequestHandler,
} from '@trpc/server/adapters/node-http';
import { Middleware } from 'koa';

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
    koaCtx?: import('koa').Context;
  }
}
declare module 'http2' {
  interface Http2ServerRequest {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    body?: any;
    koaCtx?: import('koa').Context;
  }
}

export type CreateTrpcKoaContextOptions = NodeHTTPCreateContextFnOptions<
  NodeHTTPRequest,
  NodeHTTPResponse
>;
export type AdditionalMiddlewareOpts = { prefix?: `/${string}` };
export type CreateKoaMiddlewareOptions<TRouter extends AnyRouter> = NodeHTTPHandlerOptions<
  TRouter,
  NodeHTTPRequest,
  NodeHTTPResponse
> &
  AdditionalMiddlewareOpts;

export const createKoaMiddleware =
  <TRouter extends AnyRouter>(opts: CreateKoaMiddlewareOptions<TRouter>): Middleware =>
  async (ctx, next) => {
    const { prefix } = opts;
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

    req.koaCtx = ctx;

    // koa uses 404 as a default status but some logic in
    // nodeHTTPRequestHandler assumes default status of 200.
    // https://github.com/trpc/trpc/blob/abc941152b71ff2d68c63156eb5a142174779261/packages/server/src/adapters/node-http/nodeHTTPRequestHandler.ts#L63
    res.statusCode = 200;

    await nodeHTTPRequestHandler({
      ...opts,
      req,
      res,
      path: request.path.slice((prefix?.length ?? 0) + 1),
    });
  };
