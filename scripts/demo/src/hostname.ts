import { syncBuiltinESMExports } from "node:module";
import os from "node:os";

// Preloaded into the demo's API and workers (src/instance.ts): they report DEMO_HOSTNAME as
// their host, so heartbeats and generation worker ids name a pod, not the machine.
const name = process.env.DEMO_HOSTNAME;
if (name) {
  os.hostname = () => name;
  syncBuiltinESMExports();
}
