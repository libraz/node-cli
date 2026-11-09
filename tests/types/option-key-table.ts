/**
 * Flags strings paired with the canonical option name and the `ctx.options`
 * key they produce. The runtime side (`tests/option-key-conformance.test.ts`)
 * runs each entry through the option parser and the builder; the type side
 * (`tests/types/core-typed.ts`) derives the key from the builder's types. Both
 * must agree with `name` and `key`.
 */
export const optionKeyTable = [
  { flags: "--verbose", name: "verbose", key: "verbose" },
  { flags: "-f, --force", name: "force", key: "force" },
  { flags: "-p, --port <port>", name: "port", key: "port" },
  { flags: "--tag [tag]", name: "tag", key: "tag" },
  { flags: "--colour, --color <name>", name: "colour", key: "colour" },
  { flags: "--a, --b, --c", name: "a", key: "a" },
  { flags: "-q, --quiet, -s", name: "quiet", key: "quiet" },
  { flags: "--dry-run, -n", name: "dry-run", key: "dryRun" },
  { flags: "--Foo", name: "Foo", key: "Foo" },
  { flags: "--x-1", name: "x-1", key: "x1" },
  { flags: "--ipv6-only", name: "ipv6-only", key: "ipv6Only" },
  { flags: "--log-level-name <l>", name: "log-level-name", key: "logLevelName" },
  { flags: "-V", name: "V", key: "V" },
  { flags: "-p", name: "p", key: "p" },
  { flags: "-x, -y", name: "x", key: "x" },
  { flags: "-o <file>", name: "o", key: "o" },
  { flags: "--no-color", name: "no-color", key: "noColor" },
  { flags: "--range <lo,hi>", name: "range", key: "range" },
  { flags: "  -v ,  --verbose  ", name: "verbose", key: "verbose" },
  { flags: "-1, --one", name: "one", key: "one" },
] as const;
