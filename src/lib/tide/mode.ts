// mode.ts — live TideCloak, or the simulation (Plan C).
//
// One rule, read from the one file both the browser and the server already import: an adapter
// with a `jwk` is a real, licensed realm, so the app runs against TideCloak. Anything else — the
// placeholder `npm run init` leaves, or a realm whose licensing failed — runs the simulation.
//
// Baked in at build time on both sides, so the browser and the server can never disagree about
// which mode they are in. Every simulation route refuses to answer when this is false: a live
// deployment must not grow a "log in as anyone" endpoint.

import tcConfig from "../../../data/tidecloak.json";

export const SIMULATED: boolean = !(tcConfig as { jwk?: unknown }).jwk;

/** The realm name the simulation reports, so record ids and labels match the live realm. */
export const SIM_REALM: string = (tcConfig as { realm?: string }).realm ?? "worksafe-ai";
