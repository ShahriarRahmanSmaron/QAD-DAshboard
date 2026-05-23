import type { AuthRole } from "@/lib/auth/types";

export type AdminUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: AuthRole;
  is_active: boolean;
  is_provisioned: boolean;
  permissions: string[];
  created_at: string;
  updated_at: string;
};

export type AdminUserListResponse = {
  users: AdminUser[];
  total: number;
  page: number;
  page_size: number;
};

export type AdminRoleOption = {
  id: number;
  name: AuthRole;
  description: string;
};

export type AdminRoleListResponse = {
  roles: AdminRoleOption[];
};

export type AdminUserCreatePayload = {
  email: string;
  full_name: string;
  role: AuthRole;
  permissions: string[];
};

export type AdminUserUpdatePayload = {
  full_name: string;
  role: AuthRole;
  is_active: boolean;
  permissions: string[];
};

export type AdminUserFilters = {
  search: string;
  role: string;
  status: string;
  page: number;
  pageSize: number;
};
