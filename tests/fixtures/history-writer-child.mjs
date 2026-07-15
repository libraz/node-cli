import { access, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { History } from "../../dist/shell/history.js";

const [historyPath, readyPath, startPath, line] = process.argv.slice(2);
const history = new History({ filePath: historyPath });
await history.load();
history.add(line);
await writeFile(readyPath, "ready");
while (true) {
  try {
    await access(startPath);
    break;
  } catch {
    await delay(5);
  }
}
await history.save();
