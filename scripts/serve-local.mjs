import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalSiteServer } from "../lib/local-site.mjs";

const repoPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = Number(process.env.NFL_PROP_LOCAL_PORT || 4173);
if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("NFL_PROP_LOCAL_PORT must be a valid TCP port.");

const server = createLocalSiteServer(path.join(repoPath, "dist"), {
  captureDirectory: path.join(repoPath, ".private", "browser-captures"),
});
server.listen(port, host, () => {
  const address = server.address();
  console.log(`NFL Prop Ledger is available only on this computer at http://${host}:${address.port}/`);
});
