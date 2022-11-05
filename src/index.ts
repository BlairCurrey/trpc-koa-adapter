import { AnyRouter, inferRouterContext } from '@trpc/server';
import { resolveHTTPResponse } from '@trpc/server/http';
import { Middleware } from 'koa';

export const createKoaMiddleware =
  <TRouter extends AnyRouter>({
    router,
    createContext,
  }: {
    router: TRouter;
    createContext: () => Promise<inferRouterContext<TRouter>>;
  }): Middleware =>
  async (ctx) => {
    const {
      status,
      body,
      headers: resolvedHeaders,
    } = await resolveHTTPResponse({
      router,
      path: ctx.request.path.slice(1),
      createContext,
      req: {
        method: ctx.request.method,
        query: new URLSearchParams(ctx.request.querystring),
        headers: ctx.request.headers,
        body: ctx.body,
      },
    });

    ctx.response.status = status;
    ctx.body = body;

    const headers = resolvedHeaders ?? {};
    Object.keys(headers).forEach((header) => {
      const value = headers[header];
      if (typeof value !== 'undefined') ctx.set(header, value);
    });
  };
