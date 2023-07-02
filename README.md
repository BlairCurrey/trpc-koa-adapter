# trpc-koa-adapter

This is an adapter which allows you to mount tRPC onto a Koa server. This is similar to the [trpc/packages/server/src/adapters/express.ts](https://github.com/trpc/trpc/blob/next/packages/server/src/adapters/express.ts) adapter.

# How to add tRPC to a Koa server

Initialize a tRPC router and pass into `createKoaMiddleware` with the following parameters: 

- router (required): the trpc router
- createContext (optional): a function returning the trpc context. If defined, the type should be registered on trpc initialization as shown in an example below and the trpc docs: https://trpc.io/docs/context
- prefix (optional): what to prefix the trpc routes with, such as `/trpc`

In addition to these examples, see the implementations in [`./test/createKoaMiddleware`](https://github.com/BlairCurrey/trpc-koa-adapter/blob/master/test/createKoaMiddleware.test.ts).

Example:

```ts
import Koa from 'koa';
import { createKoaMiddleware } from 'trpc-koa-adapter';
import { initTRPC } from '@trpc/server';

const ALL_USERS = [
  { id: 1, name: 'bob' },
  { id: 2, name: 'alice' },
];

const trpc = initTRPC.create();
const trpcRouter = trpc.router({
  user: trpc.procedure
    .input(Number)
    .output(Object)
    .query((req) => {
      return ALL_USERS.find((user) => req.input === user.id);
    })
});

const app = new Koa();
const adapter = createKoaMiddleware({
  router: trpcRouter,
  prefix: '/trpc'
});
app.use(adapter);
app.listen(4000);
```

You can now reach the endpoint with:
```sh
curl -X GET "http://localhost:4000/trpc/user?input=1" -H 'content-type: application/json'
```
    
Returns:    
```json
{ "id": 1, "name": "bob" }
```

Using the context:

```ts
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
  createUser: trpc.procedure.input(Object).mutation(({ input, ctx }) => {
    // ctx should be fully typed here
    if (!ctx.isAuthed()) {
      ctx.res.statusCode = 401;
      return;
    }

    const newUser = { id: Math.random(), name: input.name };
    ALL_USERS.push(newUser);

    return newUser;
  })
});

const adapter = createKoaMiddleware({
  router: trpcRouter,
  createContext,
  prefix: '/trpc',
});
```

# Development

The project uses `pnpm` for package management.

To get started clone the repo, install packages, build, and ensure tests pass:

    git clone https://github.com/BlairCurrey/trpc-koa-adapter.git
    cd trpc-koa-adapter
    pnpm i
    pnpm build
    pnpm test

Git commit messages must follow [conventional commit standard](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional) (enforced by husky hooks). Versioning is handle by github actions and is determined by commit messages according to the [semantic-release](https://github.com/semantic-release/semantic-release#commit-message-format) rules and [`.releaserc`](.releaserc) configuration.