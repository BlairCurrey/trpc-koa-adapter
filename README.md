# trpc-koa-adapter

[![npm version](https://img.shields.io/npm/v/trpc-koa-adapter.svg)](https://www.npmjs.com/package/trpc-koa-adapter)
[![CI](https://github.com/BlairCurrey/trpc-koa-adapter/actions/workflows/ci.yaml/badge.svg)](https://github.com/BlairCurrey/trpc-koa-adapter/actions/workflows/ci.yaml)
[![license](https://img.shields.io/npm/l/trpc-koa-adapter.svg)](https://github.com/BlairCurrey/trpc-koa-adapter/blob/master/LICENSE)

This is an adapter which allows you to mount [tRPC](https://github.com/trpc/trpc) onto a [Koa](https://github.com/koajs/koa) server. This is similar to the [trpc/packages/server/src/adapters/express.ts](https://github.com/trpc/trpc/blob/next/packages/server/src/adapters/express.ts) adapter.

## Compatibility

Every combination below is covered by CI:

| Dependency | Supported versions |
| ---------- | ------------------ |
| Koa        | 2 and 3            |
| tRPC       | 10 and 11          |
| Node       | 22, 24, and 26     |

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
| router                           | Required | The tRPC router to mount                                                                                                                                                                                                 |
| createContext                    | Optional | A function returning the tRPC context. If defined, the type should be registered on tRPC initialization as shown in an example below and the tRPC docs: https://trpc.io/docs/context                                     |
| prefix                           | Optional | The prefix for tRPC routes, such as `/trpc`                                                                                                                                                                              |
| `nodeHTTPRequestHandler` options | Optional | Any of the options used by the underlying request handler. See tRPC's [nodeHTTPRequestHandler](https://github.com/trpc/trpc/blob/next/packages/server/src/adapters/node-http/nodeHTTPRequestHandler.ts) for more details |

# More examples

In addition to these examples, see `/example` and the implementations in [`/test/createKoaMiddleware.test.ts`](https://github.com/BlairCurrey/trpc-koa-adapter/blob/master/test/createKoaMiddleware.test.ts).

## Using the Context:

```ts
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

## Accessing Koa Context:

`createContext` receives `koaCtx` alongside `req` and `res`:

> [!NOTE]
> While these examples show state access, `koaCtx` is the full Koa context, including session, cookies, and any custom properties added by your middleware.

```ts
// Auth middleware sets user data
app.use(async (ctx, next) => {
  const user = await authenticateRequest(ctx.headers.authorization);
  ctx.state.user = user;
  await next();
});

// Access in createContext
const createContext = ({ req, res, koaCtx }: CreateTrpcKoaContextOptions) => ({
  req,
  res,
  user: koaCtx.state.user,
});
```

### Reading and Setting Cookies

Cookies are handled through the Koa context, so pass it along in `createContext` to read and write cookies from your procedures ([discussion](https://github.com/BlairCurrey/trpc-koa-adapter/issues/21)):

```ts
const createContext = ({ koaCtx }: CreateTrpcKoaContextOptions) => ({ koaCtx });

const trpcRouter = trpc.router({
  login: trpc.procedure.mutation(({ ctx }) => {
    ctx.koaCtx.cookies.set('session', 'abc123', { httpOnly: true });
    return { loggedIn: true };
  }),
  whoami: trpc.procedure.query(({ ctx }) => ({
    session: ctx.koaCtx.cookies.get('session') ?? null,
  })),
});
```

### Type Safety

By default, `koaCtx.state` properties are typed as `any`. For stricter type safety, declare your state interface:

```ts
declare module 'koa' {
  interface DefaultState {
    user?: { id: string; name: string };
  }
}
```

# Note About Using With a Body Parser:

Using a bodyparser such as [`@koa/bodyparser`](https://github.com/koajs/bodyparser), [`koa-bodyparser`](https://www.npmjs.com/package/koa-bodyparser), or otherwise parsing the body will consume the data stream on the incoming request. To ensure that tRPC can handle the request, this library looks for the parsed body on `ctx.request.body`, which is where `@koa/bodyparser` and `koa-bodyparser` store the parsed body. If for some reason the parsed body is being stored somewhere else, and you need to parse the body before this middleware, the body will not be available to tRPC and mutations will fail as detailed [in this github issue](https://github.com/BlairCurrey/trpc-koa-adapter/issues/24).

# Development

The project uses `pnpm` for package management.

To get started clone the repo, install packages, build, and ensure tests pass:

    git clone https://github.com/BlairCurrey/trpc-koa-adapter.git
    cd trpc-koa-adapter
    pnpm i
    pnpm build
    pnpm test

Before pushing, verify formatting and lint the same way CI does:

    pnpm check:format

To apply formatting and auto-fixable lint rules instead:

    pnpm format

The `/example` directory contains a runnable client and server wired up to the
local build. See [`example/README.md`](./example/README.md).
