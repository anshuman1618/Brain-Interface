import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
};

export const requireRole = (...roles: string[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = userId;
    const role = (auth?.sessionClaims?.publicMetadata as Record<string, string>)?.role ?? "client";
    req.userRole = role;
    if (!roles.includes(role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
