const { z } = require('zod');

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._]+$/),
  phone: z.string().min(6).max(30).optional(),
  nationality: z.string().max(100).optional(),
  gender: z.string().max(40).optional(),
  emergencyContact: z.string().max(30).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')).optional(),
  vehicle: z
    .object({
      manufacturer: z.string().min(1),
      model: z.string().min(1),
      year: z.string().optional(),
      vin: z.string().optional(),
      image: z.string().optional(),
    })
    .optional(),
  social: z
    .object({
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      tiktok: z.string().optional(),
    })
    .optional(),
  agreementAccepted: z.literal(true),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const dateYmd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, 'Invalid calendar date');

const timeHm = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
    'Time must be HH:MM (24-hour)',
  );

const tripSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().optional(),
  destination: z.string().min(2, 'Destination is required'),
  meetingPoint: z.string().optional(),
  date: dateYmd,
  time: z.preprocess(
    (value) => (value === '' || value == null ? undefined : value),
    timeHm.optional(),
  ),
  difficulty: z.enum(['Easy', 'Moderate', 'Advanced', 'Expert']).optional(),
  category: z.enum([
    'Desert Drives',
    'Camping Drives',
    'Mountain Drives',
    'Trips & Events',
  ]),
  tripType: z.string().optional(),
  requiredMembership: z.string().optional(),
  requiredMembershipCode: z.string().optional(),
  minTripsRequired: z.number().int().min(0).optional(),
  coverImage: z.string().optional(),
  maxParticipants: z.number().int().min(1).max(500).optional(),
  vehicleRequirements: z.string().optional(),
  instructions: z.string().optional(),
  routeSummary: z.string().optional(),
  location: z
    .object({
      label: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    })
    .optional(),
  organizerId: z.string().uuid().optional(),
  gallery: z.array(z.string()).optional(),
  publish: z.boolean().optional(),
  status: z.enum(['draft', 'published', 'cancelled', 'completed']).optional(),
});

const ratingSchema = z.object({
  tripId: z.string().uuid(),
  memberId: z.string().uuid(),
  scores: z
    .array(
      z.object({
        criterionId: z.string().uuid().optional(),
        code: z.string().optional(),
        score: z.number().int().min(1).max(5),
      }),
    )
    .min(1),
  privateFeedback: z.string().optional(),
  publicNotes: z.string().optional(),
  recommendUpgradeTo: z.string().optional(),
  recommendUpgrade: z.union([z.boolean(), z.string()]).optional(),
  recommendationNotes: z.string().optional(),
});

function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      parsed.error.name = 'ZodError';
      return next(parsed.error);
    }
    req.validated = parsed.data;
    return next();
  };
}

const reportReasonEnum = z.enum([
  'spam',
  'harassment',
  'hate',
  'sexual_content',
  'violence',
  'other',
]);

const reportMessageSchema = z.object({
  reason: reportReasonEnum,
  details: z.string().trim().max(1000).optional().nullable(),
});

const reportMemberSchema = z.object({
  reason: reportReasonEnum,
  details: z.string().trim().max(1000).optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
});

const blockUserSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().max(500).optional().nullable(),
});

const reviewReportSchema = z.object({
  action: z.enum(['dismiss', 'resolve', 'delete_message', 'suspend_member']),
  reviewNotes: z.string().trim().max(1000).optional().nullable(),
});

module.exports = {
  signupSchema,
  loginSchema,
  tripSchema,
  ratingSchema,
  reportMessageSchema,
  reportMemberSchema,
  blockUserSchema,
  reviewReportSchema,
  validate,
};
