"use client";

import { APIProvider, Map } from "@vis.gl/react-google-maps";
import type { ReactNode } from "react";
import { MapPinOff } from "lucide-react";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_MAP_ID,
  hasGoogleMapsKey,
} from "./config";

interface MapShellProps {
  children?: ReactNode;
  defaultCenter?: google.maps.LatLngLiteral;
  defaultZoom?: number;
  /** Rendered above the map (controls, legends). Not affected by panning. */
  overlay?: ReactNode;
  className?: string;
  mapTypeId?: google.maps.MapTypeId | string;
}

/**
 * Shared Google Maps canvas: loads the JS API once per tree and renders a
 * readable message instead of a blank grey box when the key is missing.
 */
export default function MapShell({
  children,
  defaultCenter = DEFAULT_CENTER,
  defaultZoom = DEFAULT_ZOOM,
  overlay,
  className = "absolute inset-0 z-0 h-full w-full",
  mapTypeId,
}: MapShellProps) {
  if (!hasGoogleMapsKey()) return <MissingKeyNotice className={className} />;

  return (
    <div className={className}>
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
        <Map
          mapId={GOOGLE_MAPS_MAP_ID}
          defaultCenter={defaultCenter}
          defaultZoom={defaultZoom}
          mapTypeId={mapTypeId}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
          style={{ height: "100%", width: "100%" }}
        >
          {children}
        </Map>
      </APIProvider>
      {overlay}
    </div>
  );
}

function MissingKeyNotice({ className }: { className: string }) {
  return (
    <div className={className}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-100 p-6 text-center dark:bg-slate-900">
        <MapPinOff className="h-8 w-8 text-slate-400" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Google Maps is not configured
        </p>
        <p className="max-w-sm text-xs text-slate-500 dark:text-slate-400">
          Set <code className="font-mono">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in the
          environment and reload. Location data is still being recorded.
        </p>
      </div>
    </div>
  );
}
