# LibertyTS

**LibertyTS** is the native TypeScript SDK for ER:LC Private Server API v2. It supports server queries and commands, Ed25519 webhook verification, Liberty Tools relay/Poll APIs, and custom-command handlers. Install with `npm install @libertytools/libertyts`.

```ts
import { LibertyTS } from "@libertytools/libertyts";

const erlc = new LibertyTS({ serverKey: process.env.ERLC_SERVER_KEY! });
const server = await erlc.getPrivateServerAPI(["Players", "Staff"]);
console.log(server);
```

For dashboard Poll subscriptions, set `pollSubscriptionId` and `pollToken`, register handlers with `erlc.commands.command(name, handler)`, then call `await erlc.commands.start()`. Stop it with `await erlc.commands.stop()` during shutdown. Keep credentials in environment variables.

Requires Node.js 18+. Run `npm install` and `npm run build` to emit `dist/`. API payloads are unvalidated JSON; validate them before use.
