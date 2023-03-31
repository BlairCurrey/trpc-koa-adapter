/* eslint-disable @typescript-eslint/no-var-requires */

const trpcServerVersion = process.env.TRPC_SERVER_VERSION;
const koaVersion = process.env.KOA_VERSION;

const NodeEnvironment = require('jest-environment-node');
const trpcServer = require(`@trpc/server@${trpcServerVersion}`);
const Koa = require(`koa@${koaVersion}`);

class customEnvironment extends NodeEnvironment {
  async setup() {
    await super.setup();
    this.global.trpcServer = trpcServer;
    this.global.koa = Koa;
  }

  async teardown() {
    await super.teardown();
    // any teardown code you need to run goes here
  }
}

module.exports = customEnvironment;
