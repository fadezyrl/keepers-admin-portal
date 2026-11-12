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
    .regex(/^[a-zA-Z0-9._]+$/, 'Username may contain letters, numbers, dots and underscores'),
  phone: z.string().min(5).max(30).optional(),
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
  agreementAccepted: z.boolean(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function parse(schema, data) {
  return schema.parse(data);
}

module.exports = { signupSchema, loginSchema, parse };
