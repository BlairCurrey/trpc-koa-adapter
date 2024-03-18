import Koa, { Context } from 'koa';
import { createKoaMiddleware, CreateTrpcKoaContextOptions } from '../src';
import request from 'supertest';
import { inferAsyncReturnType, initTRPC } from '@trpc/server';
import * as nodeHTTPAdapter from '@trpc/server/adapters/node-http';
import { Server } from 'http';
import koaBodyParserOld from 'koa-bodyparser';
import koaBodyParser from '@koa/bodyparser';

describe('Unit', () => {
  const router = initTRPC.create().router({});
  const next = jest.fn();
  let spyNodeHTTPRequestHandler: jest.SpyInstance;

  beforeEach(async () => {
    spyNodeHTTPRequestHandler = jest
      .spyOn(nodeHTTPAdapter, 'nodeHTTPRequestHandler')
      .mockImplementationOnce(jest.fn());
  });

  afterEach(async () => {
    jest.restoreAllMocks();
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
    expect(spyNodeHTTPRequestHandler).toHaveBeenCalled();
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
    expect(spyNodeHTTPRequestHandler).toHaveBeenCalled();
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
    expect(spyNodeHTTPRequestHandler).not.toHaveBeenCalled();
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
    expect(spyNodeHTTPRequestHandler).toBeCalledWith(
      expect.objectContaining({ req: { body: ctx.request.body } })
    );
  });
});

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

  type TrpcContext = inferAsyncReturnType<typeof createContext>;

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
});
