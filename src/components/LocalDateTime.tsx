"use client";

import { formatDateTime } from "@/lib/incomeExpenseFormat";

/**
 * Renders an instant in the viewer's own timezone. Server components can't know
 * the browser's timezone, so formatting happens here; `suppressHydrationWarning`
 * covers the expected difference between the server's and the browser's output.
 */
export function LocalDateTime({ value }: { value: string | Date | null | undefined }) {
  return (
    <time suppressHydrationWarning dateTime={value ? new Date(value).toISOString() : undefined}>
      {formatDateTime(value)}
    </time>
  );
}
