import { NextResponse } from "next/server";
import { getBackendApiUrl } from "@/lib/auth/backend";

/**
 * MD09-LP: Public landing snapshot proxy.
 *
 * Fetches the public landing snapshot from the backend without forwarding
 * any authentication headers.  The backend endpoint itself requires no
 * authentication — it reads only active, non-archived workbook facts and
 * returns sanitized, aggregated data.
 */
export async function GET() {
  try {
    const response = await fetch(
      `${getBackendApiUrl()}/api/v1/public/landing-snapshot`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Unable to load landing data." },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Landing data service is unavailable." },
      { status: 502 },
    );
  }
}
