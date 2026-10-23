import { apiFetch } from "@/lib/api/client";

export type TokenResponse = {
  access: string;
  refresh: string;
  user?: {
    id: number | string;
    email: string;
    first_name?: string;
    kind?: string;
    role?: string | null;
    permissions?: string[];
  };
};

export function login(email: string, password: string) {
  return apiFetch<TokenResponse>("/auth/token/", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function register(input: { email: string; password: string; full_name: string; phone?: string }) {
  return apiFetch("/auth/register/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function requestPasswordReset(email: string) {
  return apiFetch<{ detail: string }>("/auth/password-reset/", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function confirmPasswordReset(input: { uid: string; token: string; password: string }) {
  return apiFetch<{ detail: string }>("/auth/password-reset/confirm/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function me(token: string) {
  return apiFetch("/auth/me/", { token });
}

export function refreshAccessToken(refresh: string) {
  return apiFetch<{ access: string; refresh?: string }>("/auth/token/refresh/", {
    method: "POST",
    body: JSON.stringify({ refresh }),
  });
}

export function logout(refresh: string) {
  return apiFetch<{ detail?: string }>("/auth/logout/", {
    method: "POST",
    body: JSON.stringify({ refresh }),
  });
}
