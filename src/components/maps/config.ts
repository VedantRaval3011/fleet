/** Google Maps configuration shared by every map surface. */

export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/**
 * A Map ID is required for vector maps and AdvancedMarker. Create one under
 * Google Cloud Console → Google Maps Platform → Map management and set
 * NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID. "DEMO_MAP_ID" lets the maps render before
 * that is done, but it is not meant for production traffic.
 */
export const GOOGLE_MAPS_MAP_ID =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

export const hasGoogleMapsKey = () => GOOGLE_MAPS_API_KEY.trim().length > 0;

/** Geographic centre of India — the fallback view when there is nothing to show. */
export const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
export const DEFAULT_ZOOM = 5;
