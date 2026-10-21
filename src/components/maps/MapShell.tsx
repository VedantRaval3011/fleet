"use client";

import { APIProvider, Map } from "@vis.gl/react-google-maps";
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { MapPinOff } from "lucide-react";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_MAP_ID,
  hasGoogleMapsKey,
} from "./config";

declare global {
  interface Window {
    /** Google Maps calls this global when it rejects the API key. */
    gm_authFailure?: () => void;
  }
}

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
 *
 * It also refuses to let a Maps failure take the page down with it. When Google
 * rejects the key — an unlisted referrer, lapsed billing, exhausted quota — the
 * API still loads but leaves its internals uninitialised, and the first marker
 * to set a position throws from inside a passive effect. That escapes to the
 * router's error boundary, so the whole screen becomes "Application error: a
 * client-side exception", taking the device list, the status chips and the
 * commands with it. Those are exactly what an operator needs in order to see
 * that the map is the broken part, so the failure is caught here and shown as a
 * message in the map's own box.
 */
export default function MapShell({
  children,
  defaultCenter = DEFAULT_CENTER,
  defaultZoom = DEFAULT_ZOOM,
  overlay,
  className = "absolute inset-0 z-0 h-full w-full",
  mapTypeId,
}: MapShellProps) {
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => {
    const previous = window.gm_authFailure;
    window.gm_authFailure = () => {
      setAuthFailed(true);
      previous?.();
    };
    return () => {
      window.gm_authFailure = previous;
    };
  }, []);

  if (!hasGoogleMapsKey()) return <MissingKeyNotice className={className} />;
  if (authFailed) return <KeyRejectedNotice className={className} />;

  return (
    <div className={className}>
      <MapErrorBoundary fallback={<KeyRejectedNotice className="h-full w-full" />}>
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
      </MapErrorBoundary>
      {overlay}
    </div>
  );
}

/**
 * Contains a crash from inside the Maps API or its React bindings.
 *
 * Deliberately never resets: the causes are configuration, not transient, so
 * re-rendering the map would throw again on the next frame and spin.
 */
class MapErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Google Maps failed to render:", error, info.componentStack);
  }

  render() {
    return this.state.crashed ? this.props.fallback : this.props.children;
  }
}

/**
 * Shown when the key exists but Google refused it. The origin is printed
 * because the usual cause is that this exact origin is missing from the key's
 * HTTP-referrer allowlist, and it differs per port between dev machines.
 */
function KeyRejectedNotice({ className }: { className: string }) {
  const origin = typeof window === "undefined" ? "this site" : window.location.origin;
  return (
    <div className={className}>
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-100 p-6 text-center dark:bg-slate-900">
        <MapPinOff className="h-8 w-8 text-slate-400" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Google Maps rejected this API key
        </p>
        <p className="max-w-md text-xs text-slate-500 dark:text-slate-400">
          Add <code className="font-mono">{origin}/*</code> to the key&apos;s HTTP-referrer
          restrictions in Google Cloud Console, and check that billing and the Maps
          JavaScript API are enabled. Location data is still being recorded, and the
          device list and controls on this page still work.
        </p>
      </div>
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
