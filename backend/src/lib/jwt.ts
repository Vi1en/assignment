import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { config } from "../config.js";

export type AccessPayload = {
  sub: string;
  role: "USER" | "ADMIN";
};

export function signAccessToken(payload: AccessPayload): string {
  const expiresIn = config.jwtAccessExpires as SignOptions["expiresIn"];
  return jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn,
    issuer: "orbit-backend",
    audience: "orbit-frontend",
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, config.jwtAccessSecret, {
    issuer: "orbit-backend",
    audience: "orbit-frontend",
  }) as AccessPayload & { sub: string };
  return { sub: decoded.sub, role: decoded.role };
}

export function signRefreshToken(userId: string): string {
  const expiresIn: SignOptions["expiresIn"] = `${config.jwtRefreshExpiresDays}d`;
  return jwt.sign({ sub: userId }, config.jwtRefreshSecret, {
    expiresIn,
    issuer: "orbit-backend",
    audience: "orbit-refresh",
  });
}

export function verifyRefreshToken(token: string): { sub: string } {
  const decoded = jwt.verify(token, config.jwtRefreshSecret, {
    issuer: "orbit-backend",
    audience: "orbit-refresh",
  }) as { sub: string };
  return { sub: decoded.sub };
}
