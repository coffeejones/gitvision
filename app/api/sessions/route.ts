// POST /api/sessions  — create a new session from a GitHub URL
// GET  /api/sessions  — list all sessions

import { NextResponse } from "next/server";
import { z } from "zod";
import { parseRepoUrl, analyzeRepo } from "@/lib/github";
import { validateSubdir, SubdirNotFoundError } from "@/lib/graph";
import { createSession, listSessions } from "@/lib/storage";

const CreateSchema = z.object({
  repoUrl: z.string().min(1),
  name: z.string().optional(),
  /** Optional subdir to scope the analysis to (v0.24+). Validated server-
   *  side via validateSubdir — invalid values produce a 400. Empty
   *  strings are treated as "no subdir". */
  subdir: z.string().optional(),
});

export async function GET() {
  const sessions = await listSessions();
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const parsedRepo = parseRepoUrl(parsed.data.repoUrl);
  if (!parsedRepo) {
    return NextResponse.json(
      { error: "Could not parse GitHub URL. Expected e.g. https://github.com/owner/repo" },
      { status: 400 }
    );
  }

  // Validate subdir format up-front so we can return a 400 instead of a
  // 502-from-tarball-extract for malformed inputs.
  let subdir: string | null;
  try {
    subdir = validateSubdir(parsed.data.subdir);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid subdir" },
      { status: 400 }
    );
  }

  try {
    const snapshot = await analyzeRepo(
      parsedRepo.owner,
      parsedRepo.repo,
      { subdir }
    );
    const session = await createSession({
      repoUrl: parsed.data.repoUrl,
      name: parsed.data.name || snapshot.repo.fullName,
      initialSnapshot: snapshot,
    });
    return NextResponse.json({ session });
  } catch (err) {
    // User input errors (subdir-not-found) get a 400 with the raw message
    // — the form surfaces it next to the input. Other failures (network,
    // rate-limit, server bugs) get the generic 502.
    if (err instanceof SubdirNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to analyze repo: ${message}` },
      { status: 502 }
    );
  }
}
