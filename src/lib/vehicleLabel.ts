/** Normalize vehicle field from string or { registration } for UI. */
export function vehicleLabel(vehicle: unknown): string | undefined {
  if (!vehicle) return undefined;
  if (typeof vehicle === "string") return vehicle;
  if (typeof vehicle === "object" && vehicle !== null) {
    const v = vehicle as { registration?: string; id?: string };
    return v.registration || v.id || undefined;
  }
  return undefined;
}
