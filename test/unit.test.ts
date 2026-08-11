import { Context, DefaultState } from 'koa';
import { initTRPC } from '@trpc/server';
import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import { createKoaMiddleware } from '../src';
import './koa-state';

jest.mock('@trpc/server/adapters/node-http', () => ({
  ...jest.requireActual('@trpc/server/adapters/node-http'),
  nodeHTTPRequestHandler: jest.fn(),
}));

const mockNodeHTTPRequestHandler = nodeHTTPRequestHandler as jest.Mock;

// Minimal stand-in for a koa context. `body` is only set when supplied because
// the middleware branches on `'body' in request`.
const koaContext = ({
  path,
  body,
  state,
}: {
  path: string;
  body?: unknown;
  state?: DefaultState;
}) => {
  const request: Record<string, unknown> = { path };
  if (body !== undefined) request.body = body;

  return { request, req: {}, res: {}, state: state ?? {} } as unknown as Context;
};

// The middleware is async, so every call must be awaited. Asserting
// synchronously happens to work today only because nothing awaits before
// nodeHTTPRequestHandler is called.
const handlerOptions = () => mockNodeHTTPRequestHandler.mock.calls[0][0];

describe('createKoaMiddleware', () => {
  const router = initTRPC.create().router({});
  const next = jest.fn();

  it('should return a koa middleware', () => {
    expect(typeof createKoaMiddleware({ router })).toBe('function');
  });

  describe('routing', () => {
    it('should call the handler when the path matches the prefix', async () => {
      const adapter = createKoaMiddleware({ router, prefix: '/trpc' });

      await adapter(koaContext({ path: '/trpc/users' }), next);

      expect(next).not.toHaveBeenCalled();
      expect(mockNodeHTTPRequestHandler).toHaveBeenCalled();
    });

    it('should call the handler when no prefix is configured', async () => {
      const adapter = createKoaMiddleware({ router });

      await adapter(koaContext({ path: '/users' }), next);

      expect(next).not.toHaveBeenCalled();
      expect(mockNodeHTTPRequestHandler).toHaveBeenCalled();
    });

    it('should call next and skip the handler when the path lacks the prefix', async () => {
      const adapter = createKoaMiddleware({ router, prefix: '/trpc' });

      await adapter(koaContext({ path: '/users' }), next);

      expect(next).toHaveBeenCalled();
      expect(mockNodeHTTPRequestHandler).not.toHaveBeenCalled();
    });

    // A prefix should only match whole path segments. Matching on the raw
    // string means `/trpc` also swallows routes like `/trpc-admin/users`.
    it.each(['/trpcfoo', '/trpc-admin/users', '/trpcy/users'])(
      'should call next for %s, which only shares the prefix as a string',
      async (path) => {
        const adapter = createKoaMiddleware({ router, prefix: '/trpc' });

        await adapter(koaContext({ path }), next);

        expect(next).toHaveBeenCalled();
        expect(mockNodeHTTPRequestHandler).not.toHaveBeenCalled();
      },
    );
  });

  describe('path forwarded to the handler', () => {
    it('should strip the prefix', async () => {
      const adapter = createKoaMiddleware({ router, prefix: '/trpc' });

      await adapter(koaContext({ path: '/trpc/users' }), next);

      expect(handlerOptions()).toEqual(expect.objectContaining({ path: 'users' }));
    });

    it('should keep nested segments below the prefix', async () => {
      const adapter = createKoaMiddleware({ router, prefix: '/trpc' });

      await adapter(koaContext({ path: '/trpc/nested.procedure' }), next);

      expect(handlerOptions()).toEqual(expect.objectContaining({ path: 'nested.procedure' }));
    });

    it('should strip the leading slash when no prefix is configured', async () => {
      const adapter = createKoaMiddleware({ router });

      await adapter(koaContext({ path: '/users' }), next);

      expect(handlerOptions()).toEqual(expect.objectContaining({ path: 'users' }));
    });

    it('should pass an empty path for a request to the bare prefix', async () => {
      const adapter = createKoaMiddleware({ router, prefix: '/trpc' });

      await adapter(koaContext({ path: '/trpc' }), next);

      expect(handlerOptions()).toEqual(expect.objectContaining({ path: '' }));
    });
  });

  describe('request decoration', () => {
    it('should copy a parsed body onto req.body', async () => {
      const adapter = createKoaMiddleware({ router });
      const body = { name: 'Person1', age: 20 };

      await adapter(koaContext({ path: '/users', body }), next);

      expect(handlerOptions().req).toEqual(expect.objectContaining({ body }));
    });

    it('should not set req.body when the request has no parsed body', async () => {
      const adapter = createKoaMiddleware({ router });

      await adapter(koaContext({ path: '/users' }), next);

      expect(handlerOptions().req).not.toHaveProperty('body');
    });

    it('should hand the koa context to createContext', async () => {
      const createContext = jest.fn();
      const adapter = createKoaMiddleware({ router, createContext });
      const ctx = koaContext({ path: '/users', state: { userId: 123 } });

      await adapter(ctx, next);

      const wrapped = handlerOptions().createContext;
      await wrapped({ req: ctx.req, res: ctx.res, info: {} });

      expect(createContext).toHaveBeenCalledWith(
        expect.objectContaining({ koaCtx: ctx, req: ctx.req, res: ctx.res }),
      );
    });

    it('should not pass a createContext when none was given', async () => {
      const adapter = createKoaMiddleware({ router });

      await adapter(koaContext({ path: '/users' }), next);

      expect(handlerOptions()).not.toHaveProperty('createContext');
    });

    it('should not attach the koa context to req', async () => {
      const adapter = createKoaMiddleware({ router });

      await adapter(koaContext({ path: '/users' }), next);

      expect(handlerOptions().req).not.toHaveProperty('koaCtx');
    });

    // koa defaults to 404, which nodeHTTPRequestHandler treats as meaningful.
    it('should reset the status to 200 before handing off', async () => {
      const adapter = createKoaMiddleware({ router });
      const ctx = koaContext({ path: '/users' });

      await adapter(ctx, next);

      expect(ctx.res.statusCode).toBe(200);
    });
  });

  // The middleware used to pass only a hand-picked set of options through to
  // the handler, so options like onError were silently dropped.
  // https://github.com/BlairCurrey/trpc-koa-adapter/pull/23
  it('should forward tRPC handler options to nodeHTTPRequestHandler', async () => {
    const onError = jest.fn();
    const responseMeta = jest.fn(() => ({}));
    const adapter = createKoaMiddleware({ router, prefix: '/trpc', onError, responseMeta });

    await adapter(koaContext({ path: '/trpc/users' }), next);

    expect(handlerOptions()).toEqual(expect.objectContaining({ onError, responseMeta }));
  });
});
