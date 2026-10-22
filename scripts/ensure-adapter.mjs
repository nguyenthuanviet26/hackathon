// Writes the placeholder adapter when data/tidecloak.json does not exist yet.
//
// The app imports that file at build time, and it is gitignored, so a fresh clone (or a Codespace)
// cannot even build without it. The placeholder has no jwk, which puts the app in simulation mode
// (src/lib/tide/mode.ts) until `npm run init` replaces it with a real, licensed adapter.
// Never overwrites an existing file.

import { existsSync, mkdirSync, writeFileSync } from "fs";

const file = "data/tidecloak.json";

if (!existsSync(file)) {
  mkdirSync("data", { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        _placeholder: "Replaced by `npm run init`. No jwk, so the app runs the TideCloak simulation (Plan C).",
        realm: "worksafe-ai",
        "auth-server-url": "http://localhost:8080/",
        "ssl-required": "external",
        resource: "worksafe-ai-client",
        "public-client": true,
        "confidential-port": 0,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Wrote placeholder ${file} — the app will run in simulation mode.`);
}
