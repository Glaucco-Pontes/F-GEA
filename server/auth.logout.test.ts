import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): {
  ctx: TrpcContext;
  clearedCookies: CookieCall[];
  setCookies: CookieCall[];
} {
  const clearedCookies: CookieCall[] = [];
  const setCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        setCookies.push({ name, options: { ...options, value } });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies, setCookies };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });

  it("logs in with a simple local user when no OAuth is configured", async () => {
    const { ctx, setCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.login({
      name: "Maria Souza",
      email: "maria@example.com",
    });

    expect(result.success).toBe(true);
    expect(result.user.email).toBe("maria@example.com");
    expect(setCookies.some(cookie => cookie.name === COOKIE_NAME)).toBe(true);
  });

  it("loads the workspace overview in local mode without a database", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller({
      ...ctx,
      user: {
        ...ctx.user!,
        id: 42,
        openId: "local:workspace@test.com",
        name: "Workspace User",
        email: "workspace@test.com",
        loginMethod: "local",
      },
    });

    const result = await caller.workspace.overview();

    expect(result.workspace.name).toContain("Workspace User");
    expect(Array.isArray(result.responses)).toBe(true);
    expect(result.progress.total).toBeGreaterThan(0);
  });
});
