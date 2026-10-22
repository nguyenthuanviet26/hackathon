"use client";

// The one place pages get TideCloak from. Live realm → the real SDK hook; no licensed realm → the
// simulation (Plan C), which offers the same surface. See ./mode.ts for how the mode is chosen.

import { useTideCloak as useLiveTideCloak } from "@tidecloak/nextjs";
import { useSimTideCloak } from "@/lib/sim/client";
import { SIMULATED } from "./mode";

/** The part of the SDK hook this app uses. The simulation implements exactly this. */
export type TideLike = Pick<
  ReturnType<typeof useLiveTideCloak>,
  | "isInitializing"
  | "initError"
  | "authenticated"
  | "baseURL"
  | "getConfig"
  | "getVendorId"
  | "login"
  | "logout"
  | "hasRealmRole"
  | "hasClientRole"
  | "getValueFromToken"
  | "getValueFromIdToken"
  | "secureFetch"
  | "doEncrypt"
  | "doDecrypt"
  | "approveTideRequests"
  | "initializeTideRequest"
  | "executeTideRequest"
>;

// Chosen once at module load from a build-time constant, so every render calls the same hook.
export const useTideCloak: () => TideLike = SIMULATED ? useSimTideCloak : useLiveTideCloak;

export { SIMULATED };
