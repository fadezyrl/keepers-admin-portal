import type { ApiResponse } from "./types";

const TOKEN_KEY = "keepers_admin_token";

export function getApiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:4000/api"
  );
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  auth?: boolean;
  headers?: Record<string, string>;
  formData?: FormData;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    token,
    auth = true,
    headers = {},
    formData,
  } = options;

  const url = `${getApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const reqHeaders: Record<string, string> = { ...headers };

  const bearer = token === undefined ? getStoredToken() : token;
  if (auth && bearer) {
    reqHeaders.Authorization = `Bearer ${bearer}`;
  }

  let payload: BodyInit | undefined;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    reqHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, {
    method,
    headers: reqHeaders,
    body: payload,
  });

  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(
      res.statusText || "Invalid response from server",
      "INVALID_RESPONSE",
      res.status,
    );
  }

  if (!json || typeof json !== "object") {
    throw new ApiError("Invalid response from server", "INVALID_RESPONSE", res.status);
  }

  if (!json.success) {
    throw new ApiError(
      json.error?.message || "Request failed",
      json.error?.code || "REQUEST_FAILED",
      res.status,
      json.error?.details,
    );
  }

  return json.data;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "DELETE" }),
  upload: <T>(path: string, formData: FormData, opts?: Omit<RequestOptions, "method" | "formData">) =>
    apiRequest<T>(path, { ...opts, method: "POST", formData }),
};

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
