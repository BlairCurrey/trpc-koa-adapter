// Augment Koa's default state so tests can read custom state with types.
// Shared by the unit and integration suites.
declare module 'koa' {
  interface DefaultState {
    userId?: number;
    userName?: string;
  }
}

export {};
