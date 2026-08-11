import Koa from 'koa';
import request from 'supertest';
import { initTRPC, TRPCError } from '@trpc/server';
import { Server } from 'http';
import koaBodyParserOld from 'koa-bodyparser';
import koaBodyParser from '@koa/bodyparser';
import { createKoaMiddleware, CreateTrpcKoaContextOptions } from '../src';
import './koa-state';

// This suite exercises the real nodeHTTPRequestHandler against a running Koa
// server, so unlike the unit suite it must not mock it.

describe('Integration', () => {
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
      // due to the module augmentation in ./koa-state
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

  // The middleware used to forward only a hand-picked set of options to the
  // handler, so onError never fired.
  // https://github.com/BlairCurrey/trpc-koa-adapter/pull/23
  describe('tRPC Handler Options', () => {
    const app = new Koa();
    const onError = jest.fn();

    const trpcErrors = initTRPC.create();
    const trpcErrorRouter = trpcErrors.router({
      boom: trpcErrors.procedure.query(() => {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' });
      }),
    });

    app.use(
      createKoaMiddleware({
        router: trpcErrorRouter,
        prefix: '/trpc',
        onError,
      }),
    );

    let server: Server;

    beforeEach(async () => (server = app.listen(3101)));
    afterEach(async () => await server.close());

    it('should call onError when a procedure throws', async () => {
      const response = await request(server)
        .get('/trpc/boom')
        .set('content-type', 'application/json');

      expect(response.status).toEqual(500);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: 'boom' }),
          path: 'boom',
          type: 'query',
        }),
      );
    });
  });
});
