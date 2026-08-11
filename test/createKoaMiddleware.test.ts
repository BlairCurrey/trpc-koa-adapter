import Koa, { Context } from 'koa';
import { createKoaMiddleware, CreateTrpcKoaContextOptions } from '../src';
import request from 'supertest';
import { initTRPC } from '@trpc/server';
import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import { Server } from 'http';
import koaBodyParserOld from 'koa-bodyparser';
import koaBodyParser from '@koa/bodyparser';

// Augment Koa types for type-safe state access in tests
declare module 'koa' {
  interface DefaultState {
    userId?: number;
    userName?: string;
  }
}

// Store real implementation before mocking
const realNodeHTTPRequestHandler = jest.requireActual<
  typeof import('@trpc/server/adapters/node-http')
>('@trpc/server/adapters/node-http').nodeHTTPRequestHandler;

// Mock the module - required for tRPC v11 which has frozen exports
jest.mock('@trpc/server/adapters/node-http', () => ({
  ...jest.requireActual('@trpc/server/adapters/node-http'),
  nodeHTTPRequestHandler: jest.fn(),
}));

// Get a reference to the mocked function
const mockNodeHTTPRequestHandler = nodeHTTPRequestHandler as jest.Mock;

describe('Unit', () => {
  const router = initTRPC.create().router({});
  const next = jest.fn();

  beforeEach(() => {
    mockNodeHTTPRequestHandler.mockReset();
  });

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
});

describe('Integration', () => {
  // Restore real implementation for integration tests
  beforeAll(() => {
    mockNodeHTTPRequestHandler.mockImplementation(realNodeHTTPRequestHandler);
  });

  const ALL_USERS = [
    { id: 1, name: 'bob' },
    { id: 2, name: 'alice' },
  ];

  const createContext = async ({ req, res }: CreateTrpcKoaContextOptions) => {
    return {
      req,
      res,
      isAuthed: () => req.headers.authorization === 'trustme',
    };
  };

  type TrpcContext = Awaited<ReturnType<typeof createContext>>;

  const trpc = initTRPC.context<TrpcContext>().create();
  const trpcRouter = trpc.router({
    users: trpc.procedure.output(Object).query(() => {
      return ALL_USERS;
    }),
    user: trpc.procedure
      .input(Number)
      .output(Object)
      .query((req) => {
        return ALL_USERS.find((user) => req.input === user.id);
      }),
    createUser: trpc.procedure.input(Object).mutation(({ input, ctx }) => {
      if (!ctx.isAuthed()) {
        ctx.res.statusCode = 401;
        return;
      }

      const newUser = { id: Math.random(), name: input.name };
      ALL_USERS.push(newUser);

      return newUser;
    }),
  });

  const adapter = createKoaMiddleware({
    router: trpcRouter,
    createContext,
    prefix: '/trpc',
  });

  const testCases = [
    {
      description: 'Without body parser',
      middleware: [],
    },
    {
      description: 'With koa-bodyparser',
      middleware: [koaBodyParserOld()],
    },
    {
      description: 'With @koa/bodyparser',
      middleware: [koaBodyParser()],
    },
    {
      description: 'With @koa/bodyparser using patchNode',
      middleware: [koaBodyParser({ patchNode: true, encoding: 'utf-8' })],
    },
  ];

  testCases.forEach(({ description, middleware }) => {
    describe(description, () => {
      const app = new Koa();
      middleware.forEach((middlewareItem) => app.use(middlewareItem));
      app.use(adapter);
      let server: Server;

      beforeEach(async () => (server = app.listen(3098)));
      afterEach(async () => await server.close());

      describe('Can call tRPC server endpoints succesfully', () => {
        it('GET /users', async () => {
          const response = await request(server)
            .get('/trpc/users')
            .set('content-type', 'application/json');

          expect(response.headers['content-type']).toMatch(/json/);
          expect(response.status).toEqual(200);
          expect(response.body.result.data).toEqual(ALL_USERS);
        });

        it('GET /user?id=1', async () => {
          const id = 1;
          const response = await request(server)
            .get('/trpc/user')
            .set('content-type', 'application/json')
            .query({ input: id });

          expect(response.headers['content-type']).toMatch(/json/);
          expect(response.status).toEqual(200);
          expect(response.body.result.data).toEqual(ALL_USERS.find((user) => user.id === id));
        });

        it('POST /createUser', async () => {
          const response = await request(server)
            .post('/trpc/createUser')
            .send({ name: 'eve' })
            .set('content-type', 'application/json')
            .set('authorization', 'trustme');
          const { data: newUser } = response.body.result;

          expect(response.headers['content-type']).toMatch(/json/);
          expect(response.status).toEqual(200);
          expect(newUser).toEqual(ALL_USERS.find((user) => user.id === newUser.id));
        });

        it('POST /createUser: failed auth sets status (using ctx)', async () => {
          const response = await request(server)
            .post('/trpc/createUser')
            .send({ name: 'eve' })
            .set('content-type', 'application/json');

          expect(response.headers['content-type']).toMatch(/json/);
          expect(response.status).toEqual(401);
        });
      });
      describe('Bad requests fail as expected', () => {
        it('GET /some-non-existent-route', async () => {
          const response = await request(server).get('/some-non-existent-route');
          const response2 = await request(server).get('/trpc/some-non-existent-route');

          expect(response.status).toEqual(404);
          expect(response2.status).toEqual(404);
        });
      });
    });
  });

  describe('Koa Context Access', () => {
    const app = new Koa();

    // Middleware sets state
    app.use(async (ctx, next) => {
      if (ctx.request.headers.authorization === 'trustme') {
        ctx.state.userId = 123;
        ctx.state.userName = 'Alice';
      }
      await next();
    });

    const createContextWithState = ({ req }: CreateTrpcKoaContextOptions) => ({
      // TypeScript knows userId is number | undefined and userName is string | undefined
      // due to the module augmentation above
      userId: req.koaCtx?.state.userId,
      userName: req.koaCtx?.state.userName,
    });

    type TrpcContextWithState = Awaited<ReturnType<typeof createContextWithState>>;

    const trpcWithState = initTRPC.context<TrpcContextWithState>().create();
    const trpcRouterWithState = trpcWithState.router({
      me: trpcWithState.procedure.query(({ ctx }) => ({
        userId: ctx.userId,
        userName: ctx.userName,
      })),
    });

    app.use(
      createKoaMiddleware({
        router: trpcRouterWithState,
        createContext: createContextWithState,
        prefix: '/trpc',
      }),
    );

    let server: Server;

    beforeEach(async () => (server = app.listen(3099)));
    afterEach(async () => await server.close());

    it('should access ctx.state in createContext', async () => {
      const response = await request(server)
        .get('/trpc/me')
        .set('authorization', 'trustme')
        .set('content-type', 'application/json');

      expect(response.status).toEqual(200);
      expect(response.body.result.data).toEqual({
        userId: 123,
        userName: 'Alice',
      });
    });

    it('should handle missing auth (no state)', async () => {
      const response = await request(server)
        .get('/trpc/me')
        .set('content-type', 'application/json');

      expect(response.status).toEqual(200);
      expect(response.body.result.data).toEqual({
        userId: undefined,
        userName: undefined,
      });
    });
  });

  // Reading and writing cookies requires the Koa context, which exposes
  // koa's cookie handling. https://github.com/BlairCurrey/trpc-koa-adapter/issues/21
  describe('Koa Cookies', () => {
    const app = new Koa();

    const createCookieContext = ({ req }: CreateTrpcKoaContextOptions) => ({
      koaCtx: req.koaCtx,
    });

    type TrpcCookieContext = Awaited<ReturnType<typeof createCookieContext>>;

    const trpcCookies = initTRPC.context<TrpcCookieContext>().create();
    const trpcCookieRouter = trpcCookies.router({
      login: trpcCookies.procedure.mutation(({ ctx }) => {
        ctx.koaCtx?.cookies.set('session', 'abc123', { httpOnly: true });
        return { loggedIn: true };
      }),
      whoami: trpcCookies.procedure.query(({ ctx }) => ({
        session: ctx.koaCtx?.cookies.get('session') ?? null,
      })),
    });

    app.use(
      createKoaMiddleware({
        router: trpcCookieRouter,
        createContext: createCookieContext,
        prefix: '/trpc',
      }),
    );

    let server: Server;

    beforeEach(async () => (server = app.listen(3100)));
    afterEach(async () => await server.close());

    it('should set a response cookie from a procedure', async () => {
      const response = await request(server)
        .post('/trpc/login')
        .set('content-type', 'application/json');

      expect(response.status).toEqual(200);
      expect(response.body.result.data).toEqual({ loggedIn: true });
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('session=abc123')]),
      );
    });

    it('should read a request cookie from a procedure', async () => {
      const response = await request(server)
        .get('/trpc/whoami')
        .set('content-type', 'application/json')
        .set('cookie', 'session=abc123');

      expect(response.status).toEqual(200);
      expect(response.body.result.data).toEqual({ session: 'abc123' });
    });
  });
});
