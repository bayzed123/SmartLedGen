import type { Context } from "hono";
import type { Env, AuthedUser } from "../types";
import { hashPassword, verifyPassword } from "./crypto";
import { createUser, getUserByEmail, getUserById } from "./db";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function signup(env: Env, email: string, password: string) {
  const existing = await getUserByEmail(env.DB, email);
  if (existing) throw new Error("An account with this email already exists.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  const isAdmin = email.toLowerCase().trim() === env.ADMIN_EMAIL.toLowerCase().trim();
  const passwordHash = await hashPassword(password);
  const user = await createUser(env.DB, email, passwordHash, isAdmin);
  const token = await createSession(env, user.id);
  return { user, token };
}

export async function login(env: Env, email: string, password: string) {
  const row = await getUserByEmail(env.DB, email);
  if (!row) throw new Error("Incorrect email or password.");
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw new Error("Incorrect email or password.");
  const token = await createSession(env, row.id);
  return {
    user: { id: row.id, email: row.email, is_admin: row.is_admin, free_trial_used: row.free_trial_used, plan: row.plan },
    token,
  };
}

async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  await env.SESSIONS.put(`session:${token}`, userId, { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

/** Hono middleware — attaches `user` to context, or returns 401. */
export async function requireAuth(c: Context<{ Bindings: Env; Variables: { user: AuthedUser } }>, next: () => Promise<void>) {
  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: "Missing Authorization header." }, 401);

  const userId = await c.env.SESSIONS.get(`session:${token}`);
  if (!userId) return c.json({ error: "Session expired or invalid — please log in again." }, 401);

  const user = await getUserById(c.env.DB, userId);
  if (!user) return c.json({ error: "Account not found." }, 401);

  c.set("user", user);
  await next();
}

/** Extra guard for /api/admin/* routes — run AFTER requireAuth. */
export async function requireAdmin(c: Context<{ Bindings: Env; Variables: { user: AuthedUser } }>, next: () => Promise<void>) {
  const user = c.get("user");
  if (!user?.is_admin) return c.json({ error: "Admin access only." }, 403);
  await next();
}
