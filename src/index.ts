import { AnyRouter, inferRouterContext } from '@trpc/server';
import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import { Middleware } from 'koa';

export const createKoaMiddleware =
  <TRouter extends AnyRouter>({
    router,
    createContext,
    prefix,
  }: {
    router: TRouter;
    createContext: () => Promise<inferRouterContext<TRouter>>;
    prefix?: `/${string}`;
  }): Middleware =>
  async (ctx, next) => {
    const { req, res, request } = ctx;

    if (prefix && !request.path.startsWith(prefix)) return next();

    // koa uses 404 as a default status but some logic in
    // nodeHTTPRequestHandler assumes default status of 200.
    // https://github.com/trpc/trpc/blob/abc941152b71ff2d68c63156eb5a142174779261/packages/server/src/adapters/node-http/nodeHTTPRequestHandler.ts#L63
    res.statusCode = 200;

    // could use resolveHTTPResponse if a more custom koa fit is needed, but
    // this would require re-implementing much of nodeHTTPRequestHandler here
    await nodeHTTPRequestHandler({
      router,
      createContext,
      req,
      res,
      path: request.path.slice((prefix?.length ?? 0) + 1),
    });
  };
