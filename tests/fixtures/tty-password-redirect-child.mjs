import { prompt } from "../../dist/index.js";

const password = await prompt.password("Password:");
if (password !== "secret") throw new Error("password value was not read");
process.stdout.write("PASSWORD_OK\n");
