export const stale = {
  /** Operational admin data — short freshness */
  operational: 30_000,
  /** Lists that change often during a session */
  list: 45_000,
  /** Relatively static content modules */
  content: 5 * 60_000,
  /** Rarely changing config */
  settings: 10 * 60_000,
} as const;

export const queryKeys = {
  dashboard: {
    all: ["dashboard"] as const,
    stats: () => ["dashboard", "stats"] as const,
    roles: () => ["dashboard", "roles"] as const,
  },
  members: {
    all: ["members"] as const,
    list: (params: Record<string, unknown>) => ["members", "list", params] as const,
    detail: (id: string) => ["members", "detail", id] as const,
    marshalls: () => ["members", "marshalls"] as const,
  },
  trips: {
    all: ["trips"] as const,
    list: (params: Record<string, unknown>) => ["trips", "list", params] as const,
    detail: (id: string) => ["trips", "detail", id] as const,
    calendar: (from: string, to: string) => ["trips", "calendar", from, to] as const,
  },
  registrations: {
    all: ["registrations"] as const,
    list: (params: Record<string, unknown>) =>
      ["registrations", "list", params] as const,
  },
  ratings: {
    all: ["ratings"] as const,
    list: () => ["ratings", "list"] as const,
    upgrades: (status?: string) => ["ratings", "upgrades", status || "all"] as const,
    criteria: () => ["ratings", "criteria"] as const,
  },
  content: {
    all: ["content"] as const,
    sponsors: () => ["content", "sponsors"] as const,
    gallery: () => ["content", "gallery"] as const,
    carousel: () => ["content", "carousel"] as const,
    announcements: () => ["content", "announcements"] as const,
    documents: () => ["content", "documents"] as const,
    settings: () => ["content", "settings"] as const,
  },
  events: {
    all: ["events"] as const,
    list: () => ["events", "list"] as const,
  },
} as const;

/** Map backend/webhook tags → query key prefixes to invalidate on the client. */
export const TAG_TO_QUERY_PREFIXES: Record<string, readonly (readonly string[])[]> = {
  dashboard: [queryKeys.dashboard.all],
  members: [queryKeys.members.all, queryKeys.dashboard.all],
  trips: [queryKeys.trips.all, queryKeys.dashboard.all, queryKeys.registrations.all],
  registrations: [
    queryKeys.registrations.all,
    queryKeys.trips.all,
    queryKeys.dashboard.all,
  ],
  ratings: [queryKeys.ratings.all, queryKeys.dashboard.all, queryKeys.members.all],
  sponsors: [queryKeys.content.sponsors()],
  gallery: [queryKeys.content.gallery()],
  carousel: [queryKeys.content.carousel()],
  announcements: [queryKeys.content.announcements()],
  documents: [queryKeys.content.documents()],
  events: [queryKeys.events.all],
  settings: [queryKeys.content.settings(), queryKeys.ratings.criteria()],
};
