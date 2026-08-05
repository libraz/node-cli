import { progress } from "../../dist/index.js";

const spinner = progress.spinner({ label: "SIGINT_CURSOR", stream: process.stdout });
spinner.start();
process.stdout.write("SIGINT_CURSOR_READY\n");
setInterval(() => {}, 1_000);
