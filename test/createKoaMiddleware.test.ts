/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-explicit-any */

const trpcPackage = process.env.TRPC_SERVER_VERSION
  ? `@trpc2/server@${process.env.TRPC_SERVER_VERSION}`
  : '@trpc/server';
const koaPackage = process.env.KOA_VERSION ? `koa@${process.env.KOA_VERSION}` : 'koa';

console.log({ trpcPackage, koaPackage });

// import Koa from 'koa';
const Koa = require(koaPackage);
// const Koa = require('koa@2.0.0');

import { createKoaMiddleware } from '../dist';
import request from 'supertest';

// import { initTRPC } from '@trpc/server';
const { initTRPC } = require(trpcPackage);

// import * as nodeHTTPAdapter from '@trpc/server/adapters/node-http';
const nodeHTTPAdapter = require(`${trpcPackage}/adapters/node-http`);

console.log({ nodeHTTPAdapter });
console.log({ initTRPC });

const ALL_USERS = [
  { id: 1, name: 'bob' },
  { id: 2, name: 'alice' },
];

const trpc = initTRPC.create();
const trpcRouter = trpc.router({
  users: trpc.procedure.output(Object).query(() => {
    return ALL_USERS;
  }),
  user: trpc.procedure
    .input(Number)
    .output(Object)
    .query((req: any) => {
      return ALL_USERS.find((user) => req.input === user.id);
    }),
  createUser: trpc.procedure.input(Object).mutation((req: any) => {
    const newUser = { id: Math.random(), name: req.input.name };
    ALL_USERS.push(newUser);
    return newUser;
  }),
});

const app = new Koa();
const adapter = createKoaMiddleware({
  router: trpcRouter,
  createContext: async () => {
    return {};
  },
  prefix: '/trpc',
});
app.use(adapter);
const server = app.listen(3089);

afterAll(() => server.close());
beforeEach(() => jest.clearAllMocks());

describe(`createKoaMiddleware (Koa: ${process.env.KOA_VERSION} , TRPC: ${process.env.TRPC_SERVER_VERSION})`, () => {
  it('should return a function accepting 2 arguments', () => {
    expect(typeof adapter).toBe('function');
    expect(adapter.length).toBe(2);
  });
  it('createKoaMiddleware should accept 1 argument', () => {
    expect(createKoaMiddleware.length).toBe(1);
  });
  it('createKoaMiddleware should call nodeHTTPRequestHandler if request prefix matches', () => {
    const trpcAdapterWithPrefix = createKoaMiddleware({
      router: trpcRouter,
      createContext: async () => {
        return {};
      },
      prefix: '/trpc',
    });

    const mockCtxWithPrefix = {
      request: {
        path: '/trpc/users',
      },
      req: {},
      res: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const mockNext = jest.fn(async () => {
      return {};
    });
    const originalNodeHTTPRequestHandler = nodeHTTPAdapter.nodeHTTPRequestHandler;
    Object.defineProperty(nodeHTTPAdapter, 'nodeHTTPRequestHandler', { value: jest.fn() });
    const spyNodeHTTPRequestHandler = jest.spyOn(nodeHTTPAdapter, 'nodeHTTPRequestHandler');

    trpcAdapterWithPrefix(mockCtxWithPrefix, mockNext);

    expect(mockNext.mock.calls.length).toBe(0);
    expect(spyNodeHTTPRequestHandler).toHaveBeenCalled();

    Object.defineProperty(nodeHTTPAdapter, 'nodeHTTPRequestHandler', {
      value: originalNodeHTTPRequestHandler,
    });
  });
  it('createKoaMiddleware should call nodeHTTPRequestHandler if no prefix set', () => {
    const trpcAdapterWithoutPrefix = createKoaMiddleware({
      router: trpcRouter,
      createContext: async () => {
        return {};
      },
    });

    const mockCtxWithPrefix = {
      request: {
        path: '/users',
      },
      req: {},
      res: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const mockNext = jest.fn(async () => {
      return {};
    });
    const originalNodeHTTPRequestHandler = nodeHTTPAdapter.nodeHTTPRequestHandler;
    Object.defineProperty(nodeHTTPAdapter, 'nodeHTTPRequestHandler', { value: jest.fn() });
    const spyNodeHTTPRequestHandler = jest.spyOn(nodeHTTPAdapter, 'nodeHTTPRequestHandler');

    trpcAdapterWithoutPrefix(mockCtxWithPrefix, mockNext);

    expect(mockNext.mock.calls.length).toBe(0);
    expect(spyNodeHTTPRequestHandler).toHaveBeenCalled();

    Object.defineProperty(nodeHTTPAdapter, 'nodeHTTPRequestHandler', {
      value: originalNodeHTTPRequestHandler,
    });
  });
  it('createKoaMiddleware should call next and not process request if prefix set and request doesnt have prefix', () => {
    const trpcAdapterWithPrefix = createKoaMiddleware({
      router: trpcRouter,
      createContext: async () => {
        return {};
      },
      prefix: '/trpc',
    });

    const mockCtx = {
      request: {
        path: '/users', // prefix missing from path
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const mockNext = jest.fn(async () => {
      return {};
    });
    const spyNodeHTTPRequestHandler = jest.spyOn(nodeHTTPAdapter, 'nodeHTTPRequestHandler');

    trpcAdapterWithPrefix(mockCtx, mockNext);

    expect(mockNext.mock.calls.length).toBe(1);
    expect(spyNodeHTTPRequestHandler).not.toHaveBeenCalled();
  });
});

describe('API calls', () => {
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
        .set('content-type', 'application/json');
      const { data: newUser } = response.body.result;

      expect(response.headers['content-type']).toMatch(/json/);
      expect(response.status).toEqual(200);
      expect(newUser).toEqual(ALL_USERS.find((user) => user.id === newUser.id));
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
