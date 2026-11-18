export type ApiSuccess<T> = {
  success: true;
  data: T;
  message: string;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  data?: unknown;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type AdminUser = {
  id: string;
  email: string;
  status?: string;
  roles?: Array<{ code: string; name?: string } | string>;
  permissions?: string[];
  firstName?: string;
  lastName?: string;
  username?: string;
  membership?: string;
};

export type AuthSession = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
};

export type Member = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  username: string;
  email: string;
  phone?: string | null;
  nationality?: string | null;
  avatar?: string | null;
  status: string;
  completedTrips?: number;
  membership?: string | null;
  membershipCode?: string | null;
  roles?: Array<{ code: string; name?: string }>;
  vehicle?: {
    id?: string;
    manufacturer?: string;
    model?: string;
    year?: string | number | null;
    image?: string | null;
  } | null;
  createdAt?: string;
};

export type MemberDetail = Member & {
  gender?: string | null;
  bio?: string | null;
  membershipRank?: number | null;
  vehicles?: Member["vehicle"][];
  social?: Record<string, string>;
  emergencyContacts?: Array<{
    id: string;
    name?: string | null;
    phone?: string | null;
    relationship?: string | null;
  }>;
  privacy?: { showVehicle?: boolean; showSocial?: boolean };
  completedTripHistory?: Array<{
    id: string;
    title: string;
    trip_date: string;
    destination: string;
  }>;
  approvedAt?: string | null;
};

export type Paginated<T> = {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total?: number;
  };
};

export type Trip = {
  id: string;
  title: string;
  description?: string;
  destination: string;
  meetingPoint?: string | null;
  date: string;
  time?: string | null;
  difficulty?: string;
  category?: string | null;
  tripType?: string | null;
  requiredMembership?: string | null;
  requiredMembershipCode?: string | null;
  minTripsRequired?: number;
  coverImage?: string | null;
  gallery?: string[];
  media?: Array<{
    id?: string;
    media_type?: string;
    public_url?: string;
    caption?: string | null;
  }>;
  maxParticipants?: number;
  registeredCount?: number;
  waitlistCount?: number;
  vehicleRequirements?: string | null;
  instructions?: string | null;
  routeSummary?: string | null;
  location?: {
    label?: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  organizer?: {
    id: string;
    name: string;
    role?: string;
    avatar?: string | null;
    phone?: string | null;
  } | null;
  organizerId?: string | null;
  participants?: Array<{
    id: string;
    name: string;
    avatar?: string | null;
    vehicle?: string | null;
    registrationStatus: string;
    readinessChecklist?: Array<{
      id: string;
      code: string;
      label: string;
      selected: boolean;
      submittedAt?: string;
    }>;
  }>;
  status: string;
  publishStatus?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DashboardStats = {
  totals: {
    members: number;
    activeMembers: number;
    pendingApprovals: number;
    marshalls: number;
    upcomingTrips: number;
    activeRegistrations: number;
    pendingUpgradeRequests: number;
  };
  recentActivity: Array<{
    id: string;
    action: string;
    entityType?: string;
    entityId?: string;
    actorName?: string | null;
    createdAt: string;
    metadata?: unknown;
  }>;
  upcomingCalendar: Array<{
    id: string;
    title: string;
    date: string;
    time?: string | null;
    destination?: string;
    status?: string;
    coverImage?: string | null;
  }>;
};

export type Sponsor = {
  id: string;
  name: string;
  logo?: string | null;
  url?: string | null;
  displayOrder?: number;
  isActive?: boolean;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  status: string;
  target_audience?: string;
  published_at?: string | null;
  created_at?: string;
};

export type DocumentRow = {
  id: string;
  slug: string;
  title: string;
  content?: string | null;
  document_type?: string | null;
  file_url?: string | null;
  version?: string | number | null;
  is_published?: boolean;
  updated_at?: string;
};

export type AppSetting = {
  key: string;
  value: unknown;
  description?: string | null;
  updated_at?: string;
};

export type RatingCriterion = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  min_score: number;
  max_score: number;
  display_order?: number;
  is_active?: boolean;
};

export type RatingRow = {
  id: string;
  trip_id: string;
  member_id: string;
  rated_by: string;
  overall_score: number | string;
  private_feedback?: string | null;
  public_notes?: string | null;
  created_at: string;
  member_first_name?: string;
  member_last_name?: string;
  rater_first_name?: string;
  rater_last_name?: string;
  trip_title?: string;
  scores?: Array<{
    criterionId: string;
    code: string;
    name: string;
    score: number;
  }>;
};

export type UpgradeRequest = {
  id: string;
  member_id: string;
  status: string;
  recommendation_notes?: string | null;
  decision_notes?: string | null;
  created_at: string;
  member_first_name?: string;
  member_last_name?: string;
  member_username?: string;
  recommender_first_name?: string;
  recommender_last_name?: string;
  from_level_name?: string | null;
  to_level_name?: string;
  trip_title?: string | null;
};
