import { Context } from 'koa';
import { initTRPC } from '@trpc/server';
import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import { createKoaMiddleware } from '../src';
import './koa-state';

jest.mock('@trpc/server/adapters/node-http', () => ({
  ...jest.requireActual('@trpc/server/adapters/node-http'),
  nodeHTTPRequestHandler: jest.fn(),
}));

const mockNodeHTTPRequestHandler = nodeHTTPRequestHandler as jest.Mock;

describe('Unit', () => {
  const router = initTRPC.create().router({});
  const next = jest.fn();

  it('should return a function accepting 2 arguments', () => {
    const adapter = createKoaMiddleware({
      router,
    });
    expect(typeof adapter).toBe('function');
    expect(adapter.length).toBe(2);
  });
  it('createKoaMiddleware should accept 1 argument', () => {
    expect(createKoaMiddleware.length).toBe(1);
  });
  it('createKoaMiddleware should call nodeHTTPRequestHandler if request prefix matches', () => {
    const adapter = createKoaMiddleware({ router, prefix: '/trpc' });

    const ctx = {
      request: {
        path: '/trpc/users',
      },
      req: {},
      res: {},
    } as Context;

    adapter(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockNodeHTTPRequestHandler).toHaveBeenCalled();
  });
  it('createKoaMiddleware should call nodeHTTPRequestHandler if no prefix set', () => {
    const adapter = createKoaMiddleware({ router });

    const ctx = {
      request: {
        path: '/users',
      },
      req: {},
      res: {},
    } as Context;

    adapter(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockNodeHTTPRequestHandler).toHaveBeenCalled();
  });
  it('createKoaMiddleware should call next and not process request if prefix set and request doesnt have prefix', () => {
    const adapter = createKoaMiddleware({ router, prefix: '/trpc' });

    const ctx = {
      request: {
        path: '/users', // prefix missing from path
      },
    } as Context;

    adapter(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(mockNodeHTTPRequestHandler).not.toHaveBeenCalled();
  });
  it('createKoaMiddleware should call nodeHTTPRequestHandler with req.body if parsed body found on request.body', () => {
    const adapter = createKoaMiddleware({ router });

    const ctx = {
      request: { path: '/users', body: { name: 'Person1', age: 20 } },
      req: {},
      res: {},
    } as Context;
    adapter(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockNodeHTTPRequestHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        req: expect.objectContaining({ body: ctx.request.body }),
      }),
    );
  });
  it('should attach Koa context to req.koaCtx', () => {
    const adapter = createKoaMiddleware({ router });
    const ctx = {
      request: { path: '/users' },
      req: {},
      res: {},
      state: { userId: 123 },
    } as Context;

    adapter(ctx, next);

    expect(mockNodeHTTPRequestHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        req: expect.objectContaining({ koaCtx: ctx }),
      }),
    );
  });
  // The middleware used to pass only a hand-picked set of options through to
  // the handler, so options like onError were silently dropped.
  // https://github.com/BlairCurrey/trpc-koa-adapter/pull/23
  it('should forward tRPC handler options to nodeHTTPRequestHandler', () => {
    const onError = jest.fn();
    const responseMeta = jest.fn(() => ({}));
    const adapter = createKoaMiddleware({ router, prefix: '/trpc', onError, responseMeta });

    const ctx = {
      request: { path: '/trpc/users' },
      req: {},
      res: {},
    } as Context;

    adapter(ctx, next);

    expect(mockNodeHTTPRequestHandler).toHaveBeenCalledWith(
      expect.objectContaining({ onError, responseMeta }),
    );
  });
});
