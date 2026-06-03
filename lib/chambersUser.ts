// Projects the Better Auth session into the identity the Chambers sidebar
// needs (name / @handle / tier label + paid flag). Shared by the workspace
// layout and the "/" → /cases redirect decision so both read the user the
// same way. Returns null when nobody is signed in.

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserTier } from "@/lib/billing/gates";
import { TIER_CONFIG } from "@/lib/pricing";

export interface ChambersUser {
  name: string | null;
  username: string | null;
  tierName: string;
  paid: boolean;
}

export async function getChambersUser(): Promise<ChambersUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const u = session?.user;
  if (!u) return null;
  const tier = await getUserTier(u.id);
  return {
    name: u.name ?? null,
    username: u.githubLogin ?? null,
    tierName: TIER_CONFIG[tier].name,
    paid: tier !== "open-case",
  };
}
