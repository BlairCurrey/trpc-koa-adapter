import Koa, { Middleware } from 'koa';
import request from 'supertest';
import { initTRPC, TRPCError } from '@trpc/server';
import koaBodyParserOld from 'koa-bodyparser';
import koaBodyParser from '@koa/bodyparser';
import { createKoaMiddleware, CreateTrpcKoaContextOptions } from '../src';
import './koa-state';

type User = { id: number; name: string };

// @types/koa-bodyparser depends on `@types/koa: *`, so the body parsers can be
// typed against a different copy of @types/koa than koa itself resolves to -
// which happens on the koa 2 leg of the CI matrix. Take the middleware loosely
// rather than coupling this suite to which copy wins.
type BodyParserMiddleware = unknown;

// Built per test so mutations from one test can't leak into the next.
const createUsersApp = (middleware: BodyParserMiddleware[] = []) => {
  const users: User[] = [
    { id: 1, name: 'bob' },
    { id: 2, name: 'alice' },
  ];

  const createContext = async ({ req, res }: CreateTrpcKoaContextOptions) => ({
    req,
    res,
    isAuthed: () => req.headers.authorization === 'trustme',
  });

  const trpc = initTRPC.context<Awaited<ReturnType<typeof createContext>>>().create();
  const router = trpc.router({
    users: trpc.procedure.output(Object).query(() => users),
    user: trpc.procedure
      .input(Number)
      .output(Object)
      .query((req) => users.find((user) => req.input === user.id)),
    createUser: trpc.procedure.input(Object).mutation(({ input, ctx }) => {
      if (!ctx.isAuthed()) {
        ctx.res.statusCode = 401;
        return;
      }

      const newUser = { id: users.length + 1, name: input.name };
      users.push(newUser);

      return newUser;
    }),
  });

  const app = new Koa();
  middleware.forEach((item) => app.use(item as Middleware));
  app.use(createKoaMiddleware({ router, createContext, prefix: '/trpc' }));

  return { app, users };
};

describe('Integration', () => {
  const bodyParserCases = [
    { description: 'Without body parser', middleware: () => [] },
    { description: 'With koa-bodyparser', middleware: () => [koaBodyParserOld()] },
    { description: 'With @koa/bodyparser', middleware: () => [koaBodyParser()] },
    {
      description: 'With @koa/bodyparser using patchNode',
      middleware: () => [koaBodyParser({ patchNode: true, encoding: 'utf-8' })],
    },
  ];

  bodyParserCases.forEach(({ description, middleware }) => {
    describe(description, () => {
      let app: Koa;
      let users: User[];

      beforeEach(() => ({ app, users } = createUsersApp(middleware())));

      describe('Can call tRPC server endpoints succesfully', () => {
        it('GET /users', async () => {
          const response = await request(app.callback())
            .get('/trpc/users')
            .set('content-type', 'application/json');

          expect(response.headers['content-type']).toMatch(/json/);
          expect(response.status).toEqual(200);
          expect(response.body.result.data).toEqual([
            { id: 1, name: 'bob' },
            { id: 2, name: 'alice' },
          ]);
        });

        it('GET /user?id=1', async () => {
          const response = await request(app.callback())
            .get('/trpc/user')
            .set('content-type', 'application/json')
            .query({ input: 1 });

          expect(response.headers['content-type']).toMatch(/json/);
          expect(response.status).toEqual(200);
          expect(response.body.result.data).toEqual({ id: 1, name: 'bob' });
        });

        it('POST /createUser', async () => {
          const response = await request(app.callback())
            .post('/trpc/createUser')
            .send({ name: 'eve' })
            .set('content-type', 'application/json')
            .set('authorization', 'trustme');

          expect(response.headers['content-type']).toMatch(/json/);
          expect(response.status).toEqual(200);
          expect(response.body.result.data).toEqual({ id: 3, name: 'eve' });
          expect(users).toEqual([
            { id: 1, name: 'bob' },
            { id: 2, name: 'alice' },
            { id: 3, name: 'eve' },
          ]);
        });

        it('POST /createUser: failed auth sets status (using ctx)', async () => {
          const response = await request(app.callback())
            .post('/trpc/createUser')
            .send({ name: 'eve' })
            .set('content-type', 'application/json');

          expect(response.headers['content-type']).toMatch(/json/);
          expect(response.status).toEqual(401);
          expect(users).toHaveLength(2);
        });
      });

      describe('Bad requests fail as expected', () => {
        it('GET /some-non-existent-route', async () => {
          const response = await request(app.callback()).get('/some-non-existent-route');
          const response2 = await request(app.callback()).get('/trpc/some-non-existent-route');

          expect(response.status).toEqual(404);
          expect(response2.status).toEqual(404);
        });
      });
    });
  });

  // A prefix should only match whole path segments, so routes that merely share
  // the prefix as a string still reach the rest of the koa stack.
  describe('Prefix Matching', () => {
    const buildApp = () => {
      const trpc = initTRPC.create();
      const router = trpc.router({
        users: trpc.procedure.query(() => ['bob']),
      });

      const app = new Koa();
      app.use(createKoaMiddleware({ router, prefix: '/trpc' }));
      app.use(async (ctx) => {
        ctx.status = 200;
        ctx.body = 'downstream';
      });

      return app;
    };

    it('should route requests under the prefix to tRPC', async () => {
      const response = await request(buildApp().callback()).get('/trpc/users');

      expect(response.status).toEqual(200);
      expect(response.body.result.data).toEqual(['bob']);
    });

    it.each(['/trpcfoo', '/trpc-admin/users', '/other'])(
      'should pass %s to downstream middleware',
      async (path) => {
        const response = await request(buildApp().callback()).get(path);

        expect(response.status).toEqual(200);
        expect(response.text).toEqual('downstream');
      },
    );
  });

  describe('Koa Context Access', () => {
    const buildApp = () => {
      const app = new Koa();

      // Middleware sets state
      app.use(async (ctx, next) => {
        if (ctx.request.headers.authorization === 'trustme') {
          ctx.state.userId = 123;
          ctx.state.userName = 'Alice';
        }
        await next();
      });

      const createContext = ({ koaCtx }: CreateTrpcKoaContextOptions) => ({
        // TypeScript knows userId is number | undefined and userName is
        // string | undefined due to the augmentation in ./koa-state
        userId: koaCtx.state.userId,
        userName: koaCtx.state.userName,
      });

      const trpc = initTRPC.context<Awaited<ReturnType<typeof createContext>>>().create();
      const router = trpc.router({
        me: trpc.procedure.query(({ ctx }) => ({
          userId: ctx.userId,
          userName: ctx.userName,
        })),
      });

      app.use(createKoaMiddleware({ router, createContext, prefix: '/trpc' }));

      return app;
    };

    it('should access ctx.state in createContext', async () => {
      const response = await request(buildApp().callback())
        .get('/trpc/me')
        .set('authorization', 'trustme')
        .set('content-type', 'application/json');

      expect(response.status).toEqual(200);
      expect(response.body.result.data).toStrictEqual({
        userId: 123,
        userName: 'Alice',
      });
    });

    it('should handle missing auth (no state)', async () => {
      const response = await request(buildApp().callback())
        .get('/trpc/me')
        .set('content-type', 'application/json');

      expect(response.status).toEqual(200);
      // undefined values do not survive JSON, so the keys are absent entirely.
      // toEqual would pass here even against a wrong response, since it ignores
      // undefined-valued keys.
      expect(response.body.result.data).toStrictEqual({});
    });
  });

  // Reading and writing cookies requires the Koa context, which exposes
  // koa's cookie handling. https://github.com/BlairCurrey/trpc-koa-adapter/issues/21
  describe('Koa Cookies', () => {
    const buildApp = () => {
      const createContext = ({ koaCtx }: CreateTrpcKoaContextOptions) => ({ koaCtx });

      const trpc = initTRPC.context<Awaited<ReturnType<typeof createContext>>>().create();
      const router = trpc.router({
        login: trpc.procedure.mutation(({ ctx }) => {
          ctx.koaCtx.cookies.set('session', 'abc123', { httpOnly: true });
          return { loggedIn: true };
        }),
        whoami: trpc.procedure.query(({ ctx }) => ({
          session: ctx.koaCtx.cookies.get('session') ?? null,
        })),
      });

      const app = new Koa();
      app.use(createKoaMiddleware({ router, createContext, prefix: '/trpc' }));

      return app;
    };

    it('should set a response cookie from a procedure', async () => {
      const response = await request(buildApp().callback())
        .post('/trpc/login')
        .set('content-type', 'application/json');

      expect(response.status).toEqual(200);
      expect(response.body.result.data).toStrictEqual({ loggedIn: true });
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('session=abc123')]),
      );
    });

    it('should read a request cookie from a procedure', async () => {
      const response = await request(buildApp().callback())
        .get('/trpc/whoami')
        .set('content-type', 'application/json')
        .set('cookie', 'session=abc123');

      expect(response.status).toEqual(200);
      expect(response.body.result.data).toStrictEqual({ session: 'abc123' });
    });
  });

  // The middleware used to forward only a hand-picked set of options to the
  // handler, so onError never fired.
  // https://github.com/BlairCurrey/trpc-koa-adapter/pull/23
  describe('tRPC Handler Options', () => {
    it('should call onError when a procedure throws', async () => {
      const onError = jest.fn();

      const trpc = initTRPC.create();
      const router = trpc.router({
        boom: trpc.procedure.query(() => {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' });
        }),
      });

      const app = new Koa();
      app.use(createKoaMiddleware({ router, prefix: '/trpc', onError }));

      const response = await request(app.callback())
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
