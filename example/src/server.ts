import { inferAsyncReturnType, initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import Koa from 'koa';
import { CreateTrpcKoaContextOptions } from 'trpc-koa-adapter';
import bodyParser from '@koa/bodyparser';
import { createKoaMiddleware } from 'trpc-koa-adapter';

class UserStore {
  users = [{ id: 0, name: 'Alice' }];

  constructor() {}

  nextId() {
    return this.users.length;
  }
  add(name: string) {
    this.users.push({ id: this.nextId(), name });
    return this.getLast();
  }
  findById(id: Number) {
    return this.users.find((user) => user.id === id);
  }
  getLast() {
    return this.users[this.users.length - 1];
  }
}

const USERS = new UserStore();

const createContext = ({ req, res }: CreateTrpcKoaContextOptions) => ({
  req,
  res,
  isAuthed: () => req.headers.authorization === 'trustme',
});
type Context = inferAsyncReturnType<typeof createContext>;

const t = initTRPC.context<Context>().create();

export const appRouter = t.router({
  getUser: t.procedure.input(z.number()).query((req) => {
    req.input; // number;
    return USERS.findById(req.input);
  }),
  createUser: t.procedure
    .input(z.object({ name: z.string().min(5) }))
    .mutation(({ input, ctx }) => {
      // ctx should be fully typed here
      if (!ctx.isAuthed()) {
        console.error('unauthorized');
        new TRPCError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
        return;
      }
      ctx.res.statusCode = 201;
      console.log('created');
      return USERS.add(input.name);
    }),
});

export type AppRouter = typeof appRouter;

const app = new Koa();

app.use(bodyParser());
app.use(
  createKoaMiddleware({
    router: appRouter,
    createContext,
    prefix: '/trpc',
  })
);

const port = 3098;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
