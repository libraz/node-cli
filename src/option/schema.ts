/**
 * Re-exports option-related type definitions from the central types module.
 *
 * {@link OptionSchema} describes the declarative schema for a single CLI option
 * (type, default, choices, validation, etc.).
 *
 * {@link OptionDef} is the fully resolved internal representation of an option,
 * including its canonical long name, aliases, and whether it accepts a value.
 */
export type { OptionDef, OptionSchema } from "../types.js";
