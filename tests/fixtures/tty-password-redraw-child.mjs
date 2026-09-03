import { prompt } from "../../dist/index.js";

// The label has to survive the redraws readline performs while the value is
// being edited, not just the first render.
const password = await prompt.password("Password:");
if (password !== "secrt") throw new Error(`unexpected value: ${password}`);
process.stdout.write("PASSWORD_OK\n");
