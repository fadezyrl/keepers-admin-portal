export type MapCoords = {
  latitude: number | null;
  longitude: number | null;
};

export function parseMapsUrl(input: string): MapCoords {
  const raw = (input || "").trim();
  if (!raw) return { latitude: null, longitude: null };

  const geo = raw.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (geo) return { latitude: Number(geo[1]), longitude: Number(geo[2]) };

  const at = raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return { latitude: Number(at[1]), longitude: Number(at[2]) };

  const q = raw.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (q) return { latitude: Number(q[1]), longitude: Number(q[2]) };

  const ll = raw.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (ll) return { latitude: Number(ll[1]), longitude: Number(ll[2]) };

  const dest = raw.match(/[?&]destination=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (dest) return { latitude: Number(dest[1]), longitude: Number(dest[2]) };

  return { latitude: null, longitude: null };
}

export function hasValidCoords(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  return (
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !(latitude === 0 && longitude === 0)
  );
}

export function mapsSearchUrl(opts: {
  label: string;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const label = (opts.label || "").trim() || "Destination";
  if (hasValidCoords(opts.latitude, opts.longitude)) {
    return `https://www.google.com/maps/search/?api=1&query=${opts.latitude},${opts.longitude}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`;
}
