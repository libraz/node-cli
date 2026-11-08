import { createCLI } from "../../dist/index.js";

const cli = createCLI({ name: "redirect-fixture", prompt: "HIDDEN_PROMPT> " });
cli.command("fresh").action(() => {});
await cli.start([]);
