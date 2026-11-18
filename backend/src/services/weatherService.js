/**
 * Location + date forecast via Open-Meteo (no API key).
 * Never fabricates data; returns unavailable when coords/date cannot be forecast.
 */
const { AppError } = require('../utils/AppError');
const { query } = require('../config/db');

const FORECAST_HORIZON_DAYS = 16;

const WMO_LABELS = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
};

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  try {
    return value.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function daysFromToday(dateYmd) {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  const d = String(today.getUTCDate()).padStart(2, '0');
  const todayYmd = `${y}-${m}-${d}`;
  const a = Date.parse(`${todayYmd}T00:00:00Z`);
  const b = Date.parse(`${dateYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

async function getTripWeather(tripId) {
  const res = await query(
    `SELECT id, title, trip_date, destination, location_label, latitude, longitude
     FROM trips WHERE id = $1 AND deleted_at IS NULL`,
    [tripId],
  );
  const trip = res.rows[0];
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  const date = toDateOnly(trip.trip_date);
  const lat = trip.latitude != null ? Number(trip.latitude) : null;
  const lon = trip.longitude != null ? Number(trip.longitude) : null;
  const locationLabel = trip.location_label || trip.destination || null;

  const base = {
    tripId: trip.id,
    date,
    locationLabel,
    latitude: lat,
    longitude: lon,
    kind: null,
    available: false,
    summary: null,
    temperatureMaxC: null,
    temperatureMinC: null,
    precipitationProbability: null,
    weatherCode: null,
    weatherLabel: null,
    message: null,
  };

  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      ...base,
      message: 'Forecast unavailable — drive location coordinates are not set.',
    };
  }
  if (!date) {
    return { ...base, message: 'Forecast unavailable — drive date is missing.' };
  }

  const offset = daysFromToday(date);
  if (offset == null) {
    return { ...base, message: 'Forecast unavailable for this drive date.' };
  }
  if (offset < 0) {
    return {
      ...base,
      kind: 'historical_unavailable',
      message: 'Drive date is in the past — live forecast is not shown.',
    };
  }
  if (offset > FORECAST_HORIZON_DAYS) {
    return {
      ...base,
      kind: 'out_of_range',
      message: `Forecast available closer to the drive (within ${FORECAST_HORIZON_DAYS} days).`,
    };
  }

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
    `&timezone=auto&start_date=${date}&end_date=${date}`;

  let payload;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return {
        ...base,
        message: 'Weather provider temporarily unavailable.',
      };
    }
    payload = await response.json();
  } catch {
    return {
      ...base,
      message: 'Weather provider temporarily unavailable.',
    };
  }

  const daily = payload?.daily;
  const idx = Array.isArray(daily?.time) ? daily.time.indexOf(date) : -1;
  if (idx < 0) {
    return {
      ...base,
      message: 'No forecast returned for this drive date.',
    };
  }

  const code = daily.weathercode?.[idx] ?? null;
  return {
    ...base,
    available: true,
    kind: 'forecast',
    summary: 'Drive-day forecast',
    temperatureMaxC:
      daily.temperature_2m_max?.[idx] != null
        ? Number(daily.temperature_2m_max[idx])
        : null,
    temperatureMinC:
      daily.temperature_2m_min?.[idx] != null
        ? Number(daily.temperature_2m_min[idx])
        : null,
    precipitationProbability:
      daily.precipitation_probability_max?.[idx] != null
        ? Number(daily.precipitation_probability_max[idx])
        : null,
    weatherCode: code,
    weatherLabel: code != null ? WMO_LABELS[code] || `Code ${code}` : null,
    message: null,
  };
}

module.exports = {
  getTripWeather,
};
