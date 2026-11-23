"use client";

import type { QueryClient } from "@tanstack/react-query";
import { TAG_TO_QUERY_PREFIXES, queryKeys } from "./queryKeys";

export async function invalidateTags(client: QueryClient, tags: string[]) {
  const unique = [...new Set(tags)];
  await Promise.all(
    unique.flatMap((tag) => {
      const prefixes = TAG_TO_QUERY_PREFIXES[tag] || [[tag]];
      return prefixes.map((queryKey) =>
        client.invalidateQueries({ queryKey: [...queryKey] }),
      );
    }),
  );
}

export const afterMemberMutation = (client: QueryClient) =>
  invalidateTags(client, ["members", "dashboard"]);

export const afterTripMutation = (client: QueryClient) =>
  invalidateTags(client, ["trips", "registrations", "dashboard"]);

export const afterRegistrationMutation = (client: QueryClient) =>
  invalidateTags(client, ["registrations", "trips", "dashboard"]);

export const afterRatingMutation = (client: QueryClient) =>
  invalidateTags(client, ["ratings", "members", "dashboard", "progression"]);

export const afterProgressionMutation = (client: QueryClient) =>
  invalidateTags(client, ["progression", "ratings", "members", "dashboard"]);

export const afterSponsorMutation = (client: QueryClient) =>
  invalidateTags(client, ["sponsors"]);

export const afterGalleryMutation = (client: QueryClient) =>
  invalidateTags(client, ["gallery"]);

export const afterCarouselMutation = (client: QueryClient) =>
  invalidateTags(client, ["carousel"]);

export const afterAnnouncementMutation = (client: QueryClient) =>
  invalidateTags(client, ["announcements"]);

export const afterDocumentMutation = (client: QueryClient) =>
  invalidateTags(client, ["documents"]);

export const afterEventMutation = (client: QueryClient) =>
  invalidateTags(client, ["events"]);

export const afterSettingsMutation = (client: QueryClient) =>
  invalidateTags(client, ["settings"]);

export function prefetchHints() {
  return {
    members: queryKeys.members.all,
    trips: queryKeys.trips.all,
  };
}
