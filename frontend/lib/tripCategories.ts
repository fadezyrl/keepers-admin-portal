export const TRIP_CATEGORIES = [
  "Desert Drives",
  "Camping Drives",
  "Mountain Drives",
  "Trips & Events",
] as const;

export type TripCategory = (typeof TRIP_CATEGORIES)[number];
