import Koa from 'koa';
import { createKoaMiddleware } from '../dist';
import request from 'supertest';
import { initTRPC } from '@trpc/server';

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
    .query((req) => {
      return ALL_USERS.find((user) => req.input === user.id);
    }),
  createUser: trpc.procedure.input(Object).mutation((req) => {
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
});
app.use(adapter);
const server = app.listen(3089);

afterAll(() => server.close());

describe('createKoaMiddleware', () => {
  it('should return a function', function () {
    expect(typeof adapter).toBe('function');
  });
  it('should accept 1 argument', function () {
    expect(adapter.length).toBe(1);
  });
});

describe('API calls', function () {
  describe('Can call tRPC server endpoints succesfully', function () {
    it('GET /users', async function () {
      const response = await request(server).get('/users').set('content-type', 'application/json');

      expect(response.headers['content-type']).toMatch(/json/);
      expect(response.status).toEqual(200);
      expect(response.body.result.data).toEqual(ALL_USERS);
    });

    it('GET /user?id=1', async function () {
      const id = 1;
      const response = await request(server)
        .get('/user')
        .set('content-type', 'application/json')
        .query({ input: id });

      expect(response.headers['content-type']).toMatch(/json/);
      expect(response.status).toEqual(200);
      expect(response.body.result.data).toEqual(ALL_USERS.find((user) => user.id === id));
    });

    it('POST /createUser', async function () {
      const response = await request(server)
        .post('/createUser')
        .send({ name: 'eve' })
        .set('content-type', 'application/json');
      const { data: newUser } = response.body.result;

      expect(response.headers['content-type']).toMatch(/json/);
      expect(response.status).toEqual(200);
      expect(newUser).toEqual(ALL_USERS.find((user) => user.id === newUser.id));
    });
  });
  describe('Bad requests fail as expected', function () {
    it('GET /some-non-existent-route', async function () {
      const response = await request(server)
        .get('/some-non-existent-route')
        .set('content-type', 'application/json');

      expect(response.status).toEqual(404);
    });
  });
});
