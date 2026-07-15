import { progress, truncateAnsi } from "../../dist/index.js";

const first = progress.spinner({ stream: process.stdout, frames: ["."] });
const second = progress.spinner({ stream: process.stdout, frames: ["."] });
const bar = progress.bar({ total: 2, stream: process.stdout, width: 2 });

process.stdout.write(`TTY:${process.stdout.isTTY === true}\n`);
first.start();
second.start();
bar.tick();
second.stop();
bar.finish();
first.stop();
process.stdout.write(`TRUNC:${truncateAnsi("\x1b[31mabcdef", 4)}PLAIN\n`);
const hyperlink = "\x1b]8;;https://example.invalid\x1b\\abcdef\x1b]8;;\x1b\\";
process.stdout.write(`LINK:${truncateAnsi(hyperlink, 4)}PLAIN\n`);
process.stdout.write("PROGRESS_DONE\n");
