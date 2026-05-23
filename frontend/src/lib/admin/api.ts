import type {
  AdminRoleListResponse,
  AdminUser,
  AdminUserCreatePayload,
  AdminUserFilters,
  AdminUserListResponse,
  AdminUserUpdatePayload,
} from "@/lib/admin/types";

type ApiErrorBody = {
  detail?: string;
  message?: string;
};

async function request<TResponse>(
  path: string,
  options: Omit<RequestInit, "body"> & { body?: unknown } = {},
) {
  const { body, headers, ...init } = options;
  const response = await fetch(path, {
    ...init,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  if (!response.ok) {
    let message = "Request failed.";
    try {
      const data = (await response.json()) as ApiErrorBody;
      message = data.detail ?? data.message ?? message;
    } catch {
      message = `Request failed with status ${response.status}.`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<TResponse>;
}

export function getAdminUsers(filters: AdminUserFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    page_size: String(filters.pageSize),
  });

  if (filters.search.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.role) {
    params.set("role", filters.role);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  return request<AdminUserListResponse>(`/api/admin/users?${params}`);
}

export function getAdminRoles() {
  return request<AdminRoleListResponse>("/api/admin/roles");
}

export function createAdminUser(payload: AdminUserCreatePayload) {
  return request<AdminUser>("/api/admin/users", {
    method: "POST",
    body: payload,
  });
}

export function updateAdminUser(userId: string, payload: AdminUserUpdatePayload) {
  return request<AdminUser>(`/api/admin/users/${userId}`, {
    method: "PUT",
    body: payload,
  });
}

export function resetAdminUserPassword(userId: string, password: string) {
  return request<{ ok: boolean }>(`/api/admin/users/${userId}/reset-password`, {
    method: "POST",
    body: { password },
  });
}

export function setAdminUserDisabled(userId: string, disabled: boolean) {
  return request<{ ok: boolean }>(
    `/api/admin/users/${userId}/${disabled ? "disable" : "enable"}`,
    {
      method: "POST",
    },
  );
}
