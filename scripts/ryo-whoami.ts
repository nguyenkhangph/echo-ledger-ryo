// Prints the key's label, expiry, scope and quota from /whoami (no tool quota spent). The credential is never printed.
import { RyoClient, redact } from "../agent/src/ryo/client";
const client = new RyoClient();
const who = await client.whoami();
console.log(redact(JSON.stringify(who, null, 2), client.config));
