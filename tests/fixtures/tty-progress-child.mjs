import { progress, truncateAnsi } from "../../dist/index.js";

const multi = progress.multi();
const first = multi.add({ total: 2, stream: process.stdout, width: 2 });
const second = multi.add({ total: 2, stream: process.stdout, width: 2 });

process.stdout.write(`TTY:${process.stdout.isTTY === true}\n`);
first.tick();
second.tick();
multi.finish();
process.stdout.write(`TRUNC:${truncateAnsi("\x1b[31mabcdef", 4)}PLAIN\n`);
const hyperlink = "\x1b]8;;https://example.invalid\x1b\\abcdef\x1b]8;;\x1b\\";
process.stdout.write(`LINK:${truncateAnsi(hyperlink, 4)}PLAIN\n`);
process.stdout.write("PROGRESS_DONE\n");
