import { initTRPC, TRPCError } from '@trpc/server';
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
  findById(id: number) {
    return this.users.find((user) => user.id === id);
  }
  getLast() {
    return this.users[this.users.length - 1];
  }
}

const USERS = new UserStore();

const createContext = ({ req, res, koaCtx }: CreateTrpcKoaContextOptions) => ({
  req,
  res,
  user: koaCtx.state.authenticatedUser,
  isAuthed: () => !!koaCtx.state.authenticatedUser,
});
type Context = Awaited<ReturnType<typeof createContext>>;

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
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      ctx.res.statusCode = 201;
      console.log('created');
      return USERS.add(input.name);
    }),
});

export type AppRouter = typeof appRouter;

const app = new Koa();

// Simulate auth middleware that sets user data
app.use(async (ctx, next) => {
  if (ctx.headers.authorization === 'trustme') {
    ctx.state.authenticatedUser = { id: 1, name: 'Alice' };
  }
  await next();
});

app.use(bodyParser());
app.use(
  createKoaMiddleware({
    router: appRouter,
    createContext,
    prefix: '/trpc',
  }),
);

const port = 3098;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
