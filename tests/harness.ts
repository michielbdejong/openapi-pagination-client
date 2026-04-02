/**
 * Compatibility shim — re-exports Jest's describe/it/expect,
 * adding toBeTrue() and toBeFalse() matchers used by the test suite.
 */

import { describe, it, expect as jestExpect } from "@jest/globals";

jestExpect.extend({
  toBeTrue(received: unknown) {
    const pass = received === true;
    return {
      pass,
      message: () =>
        pass
          ? `Expected value not to be true`
          : `Expected ${JSON.stringify(received)} to be true`,
    };
  },
  toBeFalse(received: unknown) {
    const pass = received === false;
    return {
      pass,
      message: () =>
        pass
          ? `Expected value not to be false`
          : `Expected ${JSON.stringify(received)} to be false`,
    };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expect(val: unknown): any {
  return jestExpect(val);
}

export { describe, it, expect };
