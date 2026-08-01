import type { Request, Response, NextFunction } from "express";
import { getOrCreateUser, resolveClerkId } from "../lib/jit";

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

// Identity comes from resolveClerkId so this works under both Clerk and the
// preview bearer token; it never reads getAuth directly.
export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const userId = resolveClerkId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
};

// Role is read from the DB (canonical, source of truth for admin-changed roles),
// not from Clerk's session claims — those only refresh on token rotation, so a
// role change by an admin would not take effect immediately if we relied on them.
export const requireRole = (...roles: string[]) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = await getOrCreateUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user.clerkId;
    req.userRole = user.role;
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
