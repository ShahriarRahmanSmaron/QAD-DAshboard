import { env } from "@/lib/env";

type ApiClientOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export async function apiClient<TResponse>(
  path: string,
  options: ApiClientOptions = {},
): Promise<TResponse> {
  const { body, headers, ...init } = options;
  const response = await fetch(`${env.apiUrl}${path}`, {
    ...init,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  return response.json() as Promise<TResponse>;
}
