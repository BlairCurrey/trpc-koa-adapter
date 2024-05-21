import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from './server';

async function main() {
  const trpcClient = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: 'http://localhost:3098/trpc',
        async headers() {
          return {
            authorization: 'trustme',
          };
        },
      }),
    ],
  });

  // getUser
  const userId = 0;
  const getUserResponse = await trpcClient.getUser.query(userId);
  console.log(`got user from id: ${userId}`, { getUserResponse });

  // createUser
  const createUserResponse = await trpcClient.createUser.mutate({ name: 'John Doe' });
  console.log(`created user: ${userId}`, { createUserResponse });
}

main();
