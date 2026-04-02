/**
 * Test runner entry point.
 * Run with: tsx tests/index.ts
 */

import { runAll } from "./harness.js";

// Import all test suites — each file registers its describe/it blocks
import "./validation.test.js";
import "./autodetect.test.js";
import "./request-builder.test.js";
import "./response-parser.test.js";
import "./client.test.js";

// Execute everything
runAll();
