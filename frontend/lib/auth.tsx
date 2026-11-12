"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, getStoredToken, setStoredToken } from "./api";
import type { AdminUser, AuthSession } from "./types";

const USER_KEY = "keepers_admin_user";

type LoginResult = {
  session: AuthSession | null;
  user: AdminUser;
  accessBlocked?: boolean;
  blockReason?: string;
  message?: string;
};

type AuthContextValue = {
  token: string | null;
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): AdminUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    return null;
  }
}

function persistUser(user: AdminUser | null) {
  if (typeof window === "undefined") return;
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

function hasAdminAccess(user: AdminUser): boolean {
  const roleCodes = (user.roles || []).map((r) =>
    typeof r === "string" ? r : r.code,
  );
  if (roleCodes.some((c) => ["admin", "super_admin"].includes(c))) return true;
  const perms = user.permissions || [];
  return perms.includes("dashboard.read") || perms.includes("members.manage");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getStoredToken();
    const storedUser = readStoredUser();
    setToken(stored);
    setUser(storedUser);
    setLoading(false);

    if (!stored) return;

    api
      .get<AdminUser>("/auth/me")
      .then((me) => {
        setUser(me);
        persistUser(me);
      })
      .catch(() => {
        setStoredToken(null);
        persistUser(null);
        setToken(null);
        setUser(null);
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<LoginResult>(
      "/auth/login",
      { email, password },
      { auth: false },
    );

    if (data.accessBlocked || !data.session?.access_token) {
      throw new ApiError(
        data.message || "Access blocked",
        data.blockReason || "ACCESS_BLOCKED",
        403,
      );
    }

    if (!hasAdminAccess(data.user)) {
      throw new ApiError(
        "This portal is restricted to Keepers administrators",
        "FORBIDDEN",
        403,
      );
    }

    setStoredToken(data.session.access_token);
    persistUser(data.user);
    setToken(data.session.access_token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    persistUser(null);
    setToken(null);
    setUser(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const me = await api.get<AdminUser>("/auth/me");
    setUser(me);
    persistUser(me);
  }, []);

  const value = useMemo(
    () => ({ token, user, loading, login, logout, refreshMe }),
    [token, user, loading, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
