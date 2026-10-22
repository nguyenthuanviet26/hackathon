"use client";

import { TideCloakProvider } from "@tidecloak/nextjs";
import tcConfig from "../../data/tidecloak.json";
import { SimProvider } from "@/lib/sim/client";
import { SIMULATED } from "@/lib/tide/mode";

// The provider takes the adapter JSON directly as the config prop.
// useDPoP goes inside the config object, not as a separate JSX prop (I-12).
// No licensed realm (no jwk in the adapter) → the simulated provider instead (Plan C).
export function Providers({ children }: { children: React.ReactNode }) {
  if (SIMULATED) return <SimProvider>{children}</SimProvider>;

  return (
    <TideCloakProvider
      config={{ ...tcConfig, useDPoP: { mode: "strict", alg: "ES256" } }}
    >
      {children}
    </TideCloakProvider>
  );
}
