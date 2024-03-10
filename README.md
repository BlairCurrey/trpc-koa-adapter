# trpc-koa-adapter

This is an adapter which allows you to mount tRPC onto a Koa server. This is similar to the [trpc/packages/server/src/adapters/express.ts](https://github.com/trpc/trpc/blob/next/packages/server/src/adapters/express.ts) adapter.

# How to Add tRPC to a Koa Server

Initialize a tRPC router and pass into `createKoaMiddleware` (along with other desired [options](#arguments)). Here is a minimal example:

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
    }),
});

const app = new Koa();
const adapter = createKoaMiddleware({
  router: trpcRouter,
  prefix: '/trpc',
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

# createKoaMiddleware Arguments <a name="arguments"></a>

The middleware takes a configuration object with the following properties:

| Option                           | Required | Description                                                                                                                                                                                                              |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| router                           | Required | The trpc router to mount                                                                                                                                                                                                 |
| createContext                    | Optional | A function returning the trpc context. If defined, the type should be registered on trpc initialization as shown in an example below and the trpc docs: https://trpc.io/docs/context                                     |
| prefix                           | Optional | The prefix for trpc routes, such as `/trpc`                                                                                                                                                                              |
| `nodeHTTPRequestHandler` options | Optional | Any of the options used by the underlying request handler. See trpc's [nodeHTTPRequestHandler](https://github.com/trpc/trpc/blob/next/packages/server/src/adapters/node-http/nodeHTTPRequestHandler.ts) for more details |

# More exampels

In addition to these examples, see the implementations in [`./test/createKoaMiddleware.test.ts`](https://github.com/BlairCurrey/trpc-koa-adapter/blob/master/test/createKoaMiddleware.test.ts).

## Using the Context:

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
  }),
});

const adapter = createKoaMiddleware({
  router: trpcRouter,
  createContext,
  prefix: '/trpc',
});
```

## With a Koa Body Parser:

Body parsing middleware such as [`@koa/bodyparser`](https://github.com/koajs/bodyparser) and [`koa-bodyparser`](https://www.npmjs.com/package/koa-bodyparser) consume the raw body on requests which trpc expects. If this middleware is added to koa after one of these body parsers, or the body is otherwise consumed before this middleware, then trpc may unexpectedly fail to handle requests (such as trpc mutation requests hanging).

If using `@koa/bodyparser` or `koa-bodyparser`, you can resolve this in either of the following ways:

- Add the trpc middleware before the body parser, if this otherwise works for you
- Use `@koa/bodyparser` or `koa-bodyparser`'s `disableBodyParser` option to disable the body parser for the trpc routes:

  ```ts
  const prefix = '/trpc';
  const app = new Koa();

  app.use(async (ctx, next) => {
    if (ctx.path.startsWith(prefix)) ctx.disableBodyParser = true;
    await next();
  });
  app.use(bodyParser());
  app.use(
    createKoaMiddleware({
      router: appRouter,
      prefix,
    })
  );
  ```

For `@koa/bodyparser` only, you can use the [`patchNode` option](https://github.com/koajs/bodyparser?tab=readme-ov-file#options) to patch the body on the request, which trpc can use instead of the raw body:

```ts
const app = new Koa();

app.use(bodyParser({ patchNode: true }));
app.use(
  createKoaMiddleware({
    router: appRouter,
    prefix,
  })
);
```

This body parsing issue was originally discussed in [this github issue](https://github.com/BlairCurrey/trpc-koa-adapter/issues/24).

# Development

The project uses `pnpm` for package management.

To get started clone the repo, install packages, build, and ensure tests pass:

    git clone https://github.com/BlairCurrey/trpc-koa-adapter.git
    cd trpc-koa-adapter
    pnpm i
    pnpm build
    pnpm test

Git commit messages must follow [conventional commit standard](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional) (enforced by husky hooks). Versioning is handle by github actions and is determined by commit messages according to the [semantic-release](https://github.com/semantic-release/semantic-release#commit-message-format) rules and [`.releaserc`](.releaserc) configuration.
