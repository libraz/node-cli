import { CLI } from "../../dist/index.js";

const cli = new CLI({ name: "redirect-fixture", prompt: "HIDDEN_PROMPT> " });
cli.command("fresh").action(() => {});
await cli.start([]);
