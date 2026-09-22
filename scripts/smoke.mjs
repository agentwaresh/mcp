// Starts the built server over stdio, lists tools and calls list_models. No wallet needed.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const res = await client.callTool({ name: "list_models", arguments: {} });
console.log(res.content[0].text.slice(0, 400));
const pk = await client.callTool({ name: "list_packages", arguments: { limit: 2 } });
console.log(pk.content[0].text.slice(0, 400));
await client.close();
