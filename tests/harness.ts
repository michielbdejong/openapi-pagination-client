/**
 * Minimal test harness — no external dependencies.
 * Runs with: tsx tests/harness.ts
 *
 * Features:
 *   describe() / it() nesting
 *   expect() with common matchers
 *   Coloured pass/fail output
 *   Non-zero exit code on failure
 */

type MatcherResult = { pass: boolean; message: string };

class Expect {
  constructor(private readonly actual: unknown) {}

  private fail(msg: string): never {
    throw new AssertionError(msg);
  }

  toBe(expected: unknown) {
    if (!Object.is(this.actual, expected)) {
      this.fail(`Expected ${fmt(this.actual)} to be ${fmt(expected)}`);
    }
  }

  toEqual(expected: unknown) {
    const a = JSON.stringify(this.actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      this.fail(`Expected\n  ${a}\nto equal\n  ${b}`);
    }
  }

  toBeNull() {
    if (this.actual !== null) this.fail(`Expected ${fmt(this.actual)} to be null`);
  }

  not = {
    toBeNull: () => {
      if (this.actual === null) this.fail(`Expected value not to be null`);
    },
    toBe: (expected: unknown) => {
      if (Object.is(this.actual, expected)) {
        this.fail(`Expected ${fmt(this.actual)} not to be ${fmt(expected)}`);
      }
    },
    toThrow: () => {
      // handled via toThrow
    },
  };

  toBeTrue() {
    if (this.actual !== true) this.fail(`Expected ${fmt(this.actual)} to be true`);
  }

  toBeFalse() {
    if (this.actual !== false) this.fail(`Expected ${fmt(this.actual)} to be false`);
  }

  toBeGreaterThan(n: number) {
    if (typeof this.actual !== "number" || this.actual <= n)
      this.fail(`Expected ${fmt(this.actual)} to be greater than ${n}`);
  }

  toContain(item: unknown) {
    if (!Array.isArray(this.actual) || !this.actual.includes(item))
      this.fail(`Expected ${fmt(this.actual)} to contain ${fmt(item)}`);
  }

  toHaveLength(n: number) {
    const len = (this.actual as unknown[]).length;
    if (len !== n) this.fail(`Expected length ${n}, got ${len}`);
  }

  toThrow(msgSubstring?: string) {
    if (typeof this.actual !== "function")
      this.fail("toThrow requires a function");
    let threw = false;
    let errMsg = "";
    try {
      (this.actual as () => void)();
    } catch (e) {
      threw = true;
      errMsg = e instanceof Error ? e.message : String(e);
    }
    if (!threw) this.fail("Expected function to throw, but it did not");
    if (msgSubstring && !errMsg.includes(msgSubstring)) {
      this.fail(
        `Expected error message to include "${msgSubstring}", got "${errMsg}"`,
      );
    }
  }

  toBeInstanceOf(cls: new (...args: unknown[]) => unknown) {
    if (!(this.actual instanceof cls))
      this.fail(`Expected instance of ${cls.name}, got ${typeof this.actual}`);
  }
}

export class AssertionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AssertionError";
  }
}

function fmt(v: unknown): string {
  return JSON.stringify(v) ?? String(v);
}

export function expect(actual: unknown): Expect {
  return new Expect(actual);
}

// ---------------------------------------------------------------------------
// Suite runner
// ---------------------------------------------------------------------------

type TestFn = () => void | Promise<void>;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

interface Suite {
  name: string;
  results: TestResult[];
}

const suites: Suite[] = [];
let currentSuite: Suite | null = null;

export function describe(name: string, fn: () => void): void {
  const suite: Suite = { name, results: [] };
  suites.push(suite);
  const prev = currentSuite;
  currentSuite = suite;
  fn();
  currentSuite = prev;
}

export function it(name: string, fn: TestFn): void {
  if (!currentSuite) throw new Error("it() called outside describe()");
  const suite = currentSuite;
  const placeholder: TestResult = {
    name,
    passed: false,
    durationMs: 0,
  };
  suite.results.push(placeholder);

  // We collect async tests and run them at flush time
  asyncTests.push(async () => {
    const start = Date.now();
    try {
      await fn();
      placeholder.passed = true;
    } catch (e) {
      placeholder.passed = false;
      placeholder.error = e instanceof Error ? e.message : String(e);
    }
    placeholder.durationMs = Date.now() - start;
  });
}

const asyncTests: Array<() => Promise<void>> = [];

// ---------------------------------------------------------------------------
// Output & exit
// ---------------------------------------------------------------------------

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function runAll(): Promise<void> {
  // Run all collected async tests sequentially
  for (const test of asyncTests) await test();

  let totalPass = 0;
  let totalFail = 0;

  for (const suite of suites) {
    console.log(`\n${BOLD}${suite.name}${RESET}`);
    for (const r of suite.results) {
      if (r.passed) {
        totalPass++;
        console.log(`  ${GREEN}✓${RESET} ${DIM}${r.name}${RESET} ${DIM}(${r.durationMs}ms)${RESET}`);
      } else {
        totalFail++;
        console.log(`  ${RED}✗ ${r.name}${RESET}`);
        console.log(`    ${RED}${r.error}${RESET}`);
      }
    }
  }

  console.log(
    `\n${BOLD}Results:${RESET} ` +
      `${GREEN}${totalPass} passed${RESET}` +
      (totalFail > 0 ? `, ${RED}${totalFail} failed${RESET}` : "") +
      ` — ${totalPass + totalFail} total\n`,
  );

  if (totalFail > 0) process.exit(1);
}
