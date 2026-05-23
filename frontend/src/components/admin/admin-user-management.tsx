"use client";

import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  UserRoundX,
  X,
} from "lucide-react";
import { FormEvent, type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  createAdminUser,
  getAdminRoles,
  getAdminUsers,
  resetAdminUserPassword,
  setAdminUserDisabled,
  updateAdminUser,
} from "@/lib/admin/api";
import type {
  AdminRoleOption,
  AdminUser,
  AdminUserCreatePayload,
  AdminUserFilters,
  AdminUserListResponse,
  AdminUserUpdatePayload,
} from "@/lib/admin/types";
import type { AuthRole } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
ModuleRegistry.registerModules([AllCommunityModule]);

const PERMISSION_OPTIONS = [
  { label: "Reports read", value: "reports:read" },
  { label: "Users manage", value: "users:manage" },
];

type UserFormState = {
  email: string;
  full_name: string;
  role: AuthRole;
  is_active: boolean;
  permission: string;
};

function getInitialFormState(user?: AdminUser): UserFormState {
  return {
    email: user?.email ?? "",
    full_name: user?.full_name ?? "",
    role: user?.role ?? "viewer",
    is_active: user?.is_active ?? true,
    permission: user?.permissions[0] ?? "",
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-foreground/25 px-4 py-6 backdrop-blur-sm">
      <section className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-lg border bg-popover p-5 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
          <Button aria-label="Close modal" onClick={onClose} size="icon" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function inputClassName() {
  return "h-10 w-full rounded-md border bg-background/70 px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring";
}

function UserForm({
  error,
  isCreate,
  isSubmitting,
  onSubmit,
  roles,
  user,
}: {
  error: string | null;
  isCreate: boolean;
  isSubmitting: boolean;
  onSubmit: (payload: AdminUserCreatePayload | AdminUserUpdatePayload) => void;
  roles: AdminRoleOption[];
  user?: AdminUser;
}) {
  const [form, setForm] = useState<UserFormState>(() => getInitialFormState(user));
  const [validationError, setValidationError] = useState<string | null>(null);

  function updateField<TField extends keyof UserFormState>(
    field: TField,
    value: UserFormState[TField],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    if (!form.full_name.trim()) {
      setValidationError("Full name is required.");
      return;
    }

    if (isCreate && !form.email.includes("@")) {
      setValidationError("Enter a valid email address.");
      return;
    }

    const commonPayload = {
      full_name: form.full_name.trim(),
      role: form.role,
      permissions: form.permission ? [form.permission] : [],
    };

    if (isCreate) {
      onSubmit({
        ...commonPayload,
        email: form.email.trim().toLowerCase(),
      });
      return;
    }

    onSubmit({
      ...commonPayload,
      is_active: form.is_active,
    });
  }

  return (
    <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name">
          <input
            className={inputClassName()}
            onChange={(event) => updateField("full_name", event.target.value)}
            required
            value={form.full_name}
          />
        </Field>
        <Field label="Email">
          <input
            className={inputClassName()}
            disabled={!isCreate}
            onChange={(event) => updateField("email", event.target.value)}
            required
            type="email"
            value={form.email}
          />
        </Field>
        <Field label="Role">
          <select
            className={inputClassName()}
            onChange={(event) => updateField("role", event.target.value as AuthRole)}
            value={form.role}
          >
            {roles.map((role) => (
              <option key={role.name} value={role.name}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Permission">
          <select
            className={inputClassName()}
            onChange={(event) => updateField("permission", event.target.value)}
            value={form.permission}
          >
            <option value="">None</option>
            {PERMISSION_OPTIONS.map((permission) => (
              <option key={permission.value} value={permission.value}>
                {permission.label}
              </option>
            ))}
          </select>
        </Field>
        {!isCreate ? (
          <Field label="Account status">
            <select
              className={inputClassName()}
              onChange={(event) => updateField("is_active", event.target.value === "active")}
              value={form.is_active ? "active" : "disabled"}
            >
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </Field>
        ) : null}
      </div>
      {validationError || error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {validationError ?? error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {isCreate ? "Create user" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function ResetPasswordForm({
  error,
  isSubmitting,
  onSubmit,
}: {
  error: string | null;
  isSubmitting: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    if (password.length < 8) {
      setValidationError("Password must be at least 8 characters.");
      return;
    }
    onSubmit(password);
  }

  return (
    <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
      <Field label="New password">
        <input
          className={inputClassName()}
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </Field>
      {validationError || error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {validationError ?? error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Reset password
        </Button>
      </div>
    </form>
  );
}

function UserActions({
  onDisable,
  onEdit,
  onResetPassword,
  user,
}: {
  onDisable: (user: AdminUser) => void;
  onEdit: (user: AdminUser) => void;
  onResetPassword: (user: AdminUser) => void;
  user: AdminUser;
}) {
  return (
    <div className="flex h-full items-center gap-1">
      <Button onClick={() => onEdit(user)} size="icon" title="Edit user" variant="ghost">
        <SlidersHorizontal className="size-4" />
      </Button>
      <Button
        onClick={() => onResetPassword(user)}
        size="icon"
        title="Reset password"
        variant="ghost"
      >
        <KeyRound className="size-4" />
      </Button>
      <Button
        onClick={() => onDisable(user)}
        size="icon"
        title={user.is_active ? "Disable account" : "Enable account"}
        variant="ghost"
      >
        {user.is_active ? (
          <UserRoundX className="size-4" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
      </Button>
    </div>
  );
}

export function AdminUserManagement() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<AdminUserFilters>({
    search: "",
    role: "",
    status: "",
    page: 1,
    pageSize: 20,
  });
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-users", filters],
    queryFn: () => getAdminUsers(filters),
  });
  const rolesQuery = useQuery({
    queryKey: ["admin-roles"],
    queryFn: getAdminRoles,
  });

  const roles = rolesQuery.data?.roles ?? [
    { id: 1, name: "admin", description: "Full access" },
    { id: 2, name: "editor", description: "Editor access" },
    { id: 3, name: "viewer", description: "Viewer access" },
  ];
  const users = usersQuery.data?.users ?? [];
  const total = usersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  function invalidateUsers() {
    void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  }

  const createMutation = useMutation({
    mutationFn: createAdminUser,
    onError: (error) => setMutationError(error.message),
    onSuccess: () => {
      setIsCreateOpen(false);
      setMutationError(null);
      invalidateUsers();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ payload, userId }: { payload: AdminUserUpdatePayload; userId: string }) =>
      updateAdminUser(userId, payload),
    onError: (error) => setMutationError(error.message),
    onSuccess: () => {
      setEditingUser(null);
      setMutationError(null);
      invalidateUsers();
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ password, userId }: { password: string; userId: string }) =>
      resetAdminUserPassword(userId, password),
    onError: (error) => setMutationError(error.message),
    onSuccess: () => {
      setResetUser(null);
      setMutationError(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ disabled, userId }: { disabled: boolean; userId: string }) =>
      setAdminUserDisabled(userId, disabled),
    onMutate: async ({ disabled, userId }) => {
      await queryClient.cancelQueries({ queryKey: ["admin-users"] });
      const previous = queryClient.getQueryData<AdminUserListResponse>([
        "admin-users",
        filters,
      ]);
      queryClient.setQueryData<AdminUserListResponse>(["admin-users", filters], (current) =>
        current
          ? {
              ...current,
              users: current.users.map((user) =>
                user.id === userId ? { ...user, is_active: !disabled ? true : false } : user,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      setMutationError(error.message);
      if (context?.previous) {
        queryClient.setQueryData(["admin-users", filters], context.previous);
      }
    },
    onSettled: invalidateUsers,
  });

  const columnDefs = useMemo<ColDef<AdminUser>[]>(
    () => [
      {
        field: "full_name",
        flex: 1.2,
        headerName: "Name",
        minWidth: 180,
        valueGetter: (params) => params.data?.full_name ?? "Unnamed user",
      },
      { field: "email", flex: 1.4, headerName: "Email", minWidth: 220 },
      {
        field: "role",
        headerName: "Role",
        minWidth: 110,
        valueFormatter: (params) => String(params.value),
      },
      {
        field: "is_active",
        headerName: "Status",
        minWidth: 150,
        valueGetter: (params) => {
          if (!params.data?.is_provisioned) {
            return "not provisioned";
          }
          return params.data.is_active ? "active" : "disabled";
        },
      },
      {
        field: "permissions",
        flex: 1.2,
        headerName: "Permission",
        minWidth: 180,
        valueFormatter: (params) => (params.value as string[] | undefined)?.join(", ") || "None",
      },
      {
        field: "created_at",
        headerName: "Created",
        minWidth: 180,
        valueFormatter: (params) => formatDate(String(params.value)),
      },
      {
        cellRenderer: (params: ICellRendererParams<AdminUser>) =>
          params.data ? (
            <UserActions
              onDisable={(user) =>
                statusMutation.mutate({ disabled: user.is_active, userId: user.id })
              }
              onEdit={setEditingUser}
              onResetPassword={setResetUser}
              user={params.data}
            />
          ) : null,
        headerName: "",
        minWidth: 150,
        pinned: "right",
        sortable: false,
      },
    ],
    [statusMutation],
  );

  function updateFilters(nextFilters: Partial<AdminUserFilters>) {
    setFilters((current) => ({ ...current, ...nextFilters, page: nextFilters.page ?? 1 }));
  }

  return (
    <section className="flex flex-1 flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Administration</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal sm:text-3xl">
            User management
          </h1>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="size-4" />
          New user
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.8fr_auto]">
          <label className="flex h-10 items-center gap-2 rounded-md border bg-background/70 px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
              onChange={(event) => updateFilters({ search: event.target.value })}
              placeholder="Search users"
              value={filters.search}
            />
          </label>
          <select
            className={inputClassName()}
            onChange={(event) => updateFilters({ role: event.target.value })}
            value={filters.role}
          >
            <option value="">All roles</option>
            {roles.map((role) => (
              <option key={role.name} value={role.name}>
                {role.name}
              </option>
            ))}
          </select>
          <select
            className={inputClassName()}
            onChange={(event) => updateFilters({ status: event.target.value })}
            value={filters.status}
          >
            <option value="">All statuses</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
          <select
            className={inputClassName()}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                page: 1,
                pageSize: Number(event.target.value),
              }))
            }
            value={filters.pageSize}
          >
            {PAGE_SIZE_OPTIONS.map((pageSize) => (
              <option key={pageSize} value={pageSize}>
                {pageSize}/page
              </option>
            ))}
          </select>
        </div>

        {mutationError ? (
          <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {mutationError}
          </p>
        ) : null}
        {usersQuery.error ? (
          <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {usersQuery.error.message}
          </p>
        ) : null}

        <div
          className={cn(
            "ag-theme-quartz mt-4 h-[34rem] w-full overflow-hidden rounded-md border",
            "dark:ag-theme-quartz-dark",
          )}
        >
          <AgGridReact
            columnDefs={columnDefs}
            loading={usersQuery.isLoading || usersQuery.isFetching}
            noRowsOverlayComponent={() => (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                No users match the current filters.
              </div>
            )}
            rowData={users}
            rowHeight={54}
            suppressCellFocus
            theme="legacy"
          />
        </div>

        <div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Showing {users.length} of {total} users
          </span>
          <div className="flex items-center gap-2">
            <Button
              disabled={filters.page <= 1}
              onClick={() => updateFilters({ page: filters.page - 1 })}
              variant="outline"
            >
              Previous
            </Button>
            <span className="min-w-20 text-center">
              {filters.page} / {totalPages}
            </span>
            <Button
              disabled={filters.page >= totalPages}
              onClick={() => updateFilters({ page: filters.page + 1 })}
              variant="outline"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {isCreateOpen ? (
        <Modal
          onClose={() => {
            setIsCreateOpen(false);
            setMutationError(null);
          }}
          title="Create user"
        >
          <UserForm
            error={mutationError}
            isCreate
            isSubmitting={createMutation.isPending}
            onSubmit={(payload) => createMutation.mutate(payload as AdminUserCreatePayload)}
            roles={roles}
          />
        </Modal>
      ) : null}

      {editingUser ? (
        <Modal
          onClose={() => {
            setEditingUser(null);
            setMutationError(null);
          }}
          title="Edit user"
        >
          <UserForm
            error={mutationError}
            isCreate={false}
            isSubmitting={updateMutation.isPending}
            onSubmit={(payload) =>
              updateMutation.mutate({
                payload: payload as AdminUserUpdatePayload,
                userId: editingUser.id,
              })
            }
            roles={roles}
            user={editingUser}
          />
        </Modal>
      ) : null}

      {resetUser ? (
        <Modal
          onClose={() => {
            setResetUser(null);
            setMutationError(null);
          }}
          title={`Reset password for ${resetUser.email}`}
        >
          <ResetPasswordForm
            error={mutationError}
            isSubmitting={resetPasswordMutation.isPending}
            onSubmit={(password) =>
              resetPasswordMutation.mutate({ password, userId: resetUser.id })
            }
          />
        </Modal>
      ) : null}
    </section>
  );
}
