# trpc-koa-adapter

This is an adapter which allows you to integrate tRPC with a Koa server. This is similar to the [trpc/packages/server/src/adapters/express.ts](https://github.com/trpc/trpc/blob/next/packages/server/src/adapters/express.ts) adapter.

# How to add tRPC to a Koa server

See `./test/trpcKoaAdapter.test.ts` for example usage.

```ts
import Koa from 'koa';
import { createKoaMiddleware } from 'trpc-koa-adapter';
import { router } from '@trpc/server';

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
  createContext: async () => { return {}; }
});
app.use(adapter);
app.listen(4000);
```

You can now reach the endpoint with:
```sh
curl -X GET "http://localhost:4000/user?input=1" -H 'content-type: application/json'
```
    
Returns:    
```json
{"id":1,"name":"bob"}
```