import { progress } from "../../dist/index.js";

progress.spinner({ label: "SIGINT_CURSOR", stream: process.stdout });
process.stdout.write("SIGINT_CURSOR_READY\n");
setInterval(() => {}, 1_000);
