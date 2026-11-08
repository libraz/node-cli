import type { Writable } from "node:stream";
import { createLogger, type Logger, type LoggerOptions, type LogLevel } from "../../src/index.js";

declare const stream: Writable;

const options: LoggerOptions = { level: "debug", prefix: "app", timestamp: true, stream };
const log: Logger = createLogger(options);
const defaults: Logger = createLogger();
void defaults;

// Every level method takes an unknown message.
log.debug("text");
log.info(new Error("boom"));
log.success({ id: 1 });
log.warn(undefined, "extra", 1);
log.error(42);

// setLevel returns the logger so calls chain.
const chained: Logger = log.setLevel("info").setLevel("warn");
void chained;
const child: Logger = log.child("db").setLevel("error");
void child;

const levels: readonly LogLevel[] = ["debug", "info", "warn", "error", "silent"] as const;
void levels;

// @ts-expect-error the factory is named createLogger
import { logger } from "../../src/index.js";

void logger;

// @ts-expect-error unknown level
log.setLevel("verbose");
// @ts-expect-error unknown level in the options
createLogger({ level: "verbose" });
// @ts-expect-error unknown option
createLogger({ colour: true });
// @ts-expect-error the stream must be a Writable
createLogger({ stream: "stderr" });
