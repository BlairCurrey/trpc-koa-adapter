#!/bin/bash

# Define the versions of trpc-server and koa to test
# TRPC_SERVER_VERSIONS=("10.0.0-rc.4" "latest")
# KOA_VERSIONS=("2.2.0" "latest")
TRPC_SERVER_VERSIONS=("10.0.0-rc.4")
KOA_VERSIONS=("2.2.0")

# Run Jest tests against each version combination
for TRPC_SERVER_VERSION in "${TRPC_SERVER_VERSIONS[@]}"; do
  for KOA_VERSION in "${KOA_VERSIONS[@]}"; do
    if [ "${TRPC_SERVER_VERSION}" = "latest" ]; then
      TRPC_SERVER_VERSION=
    fi
    if [ "${KOA_VERSION}" = "latest" ]; then
      KOA_VERSION=
    fi
    TRPC_SERVER_VERSION=$TRPC_SERVER_VERSION KOA_VERSION=$KOA_VERSION pnpm jest --config jest.config.js
    # pnpm jest --config jest.config.js
  done
done

# FAIL: { trpcPackage: '@trpc/server@10.0.0-rc.4', koaPackage: 'koa@2.2.0' }
# FAIL: { trpcPackage: '@trpc/server@10.0.0-rc.4', koaPackage: 'koa' }
# PASS: { trpcPackage: '@trpc/server', koaPackage: 'koa@2.2.0' }
# PASS: { trpcPackage: '@trpc/server', koaPackage: 'koa' }
# so the old trpc version failed... but it was working before????