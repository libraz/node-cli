/**
 * Flags strings paired with the `ctx.options` key they produce. The runtime side
 * (`tests/option-key-conformance.test.ts`) runs each entry through the option
 * parser; the type side (`tests/types/core-typed.ts`) derives the key from the
 * builder's types. Both must agree with `key`.
 */
export const optionKeyTable = [
  { flags: "--verbose", key: "verbose" },
  { flags: "-f, --force", key: "force" },
  { flags: "-p, --port <port>", key: "port" },
  { flags: "--tag [tag]", key: "tag" },
  { flags: "--colour, --color <name>", key: "color" },
  { flags: "--a, --b, --c", key: "c" },
  { flags: "-q, --quiet, -s", key: "quiet" },
  { flags: "--dry-run, -n", key: "dry-run" },
  { flags: "-p", key: "p" },
  { flags: "-x, -y", key: "x" },
  { flags: "-o <file>", key: "o" },
  { flags: "--no-color", key: "no-color" },
  { flags: "--range <lo,hi>", key: "range" },
  { flags: "  -v ,  --verbose  ", key: "verbose" },
  { flags: "-1, --one", key: "one" },
] as const;
