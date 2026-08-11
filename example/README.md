This example runs against the adapter in this repo (`trpc-koa-adapter` is linked
to the parent directory), so build it first:

    cd .. && pnpm i && pnpm build
    cd example && pnpm i

Then, in separate terminals:

Start the server:

    pnpm server:start

Run the client to make requests:

    pnpm client:start

Edit the server and client as needed to test different use-cases and restart.
