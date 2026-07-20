// Shared sessionStorage key for the "resume my analysis after signup"
// handoff. A logged-out visitor who pastes a repo on the landing has it
// stashed here, then is sent to /signup; after auth they land in the
// workspace, which reads this key and auto-runs the analysis.
//
// Lives in its own module so the writer (CTLandingIntake on the landing) and the
// reader (WorkspaceInputBar on /cases) can't drift on the string.
export const PENDING_REPO_KEY = "ct:pending-repo";
