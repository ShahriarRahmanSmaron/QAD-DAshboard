export type AuthRole = "admin" | "editor" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: AuthRole;
  permissions: string[];
};

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number | null;
  token_type: string;
  user: AuthUser;
};

export type CurrentUserResponse = {
  user: AuthUser;
};
