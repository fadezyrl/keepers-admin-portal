/**
 * Idempotent seed: populate Supabase with Keepers RN demo content.
 *
 * Usage:
 *   node scripts/seed-demo-content.js
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL (or database_url)
 *
 * Rules:
 * - Does not overwrite non-demo / production records (matched by demo_key / unique title+date / email)
 * - Safe to re-run
 * - Uploads local assets from the Keepers RN project into existing Storage buckets
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const RN_ROOT = path.resolve(__dirname, '../../../keepers');
const ASSETS = path.join(RN_ROOT, 'assets', 'images');
const DEMO_MARKER = '[Demo]';
const isProd =
  String(process.env.NODE_ENV || '').toLowerCase() === 'production' ||
  String(process.env.KEEPERS_ENV || '').toLowerCase() === 'production';

if (isProd && !process.env.SEED_DEMO_PASSWORD) {
  console.error(
    'Refusing to seed demo users in production without SEED_DEMO_PASSWORD.',
  );
  process.exit(1);
}

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'KeepersDemo123!';
if (!process.env.SEED_DEMO_PASSWORD) {
  console.warn(
    'SEED_DEMO_PASSWORD not set — using local-dev default. Do not use on shared/prod.',
  );
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL || process.env.database_url;

if (!supabaseUrl || !serviceKey || !databaseUrl) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function asset(...parts) {
  return path.join(ASSETS, ...parts);
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing asset: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/jpeg';
}

async function upload(bucket, storagePath, filePath, cacheControl = '3600') {
  const body = readFile(filePath);
  const contentType = mimeFor(filePath);
  const { error } = await supabase.storage.from(bucket).upload(storagePath, body, {
    contentType,
    upsert: true,
    cacheControl,
  });
  if (error) {
    throw new Error(`Upload failed ${bucket}/${storagePath}: ${error.message}`);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return { storagePath, publicUrl: data.publicUrl };
}

function sectionsToMarkdown(title, sections) {
  const blocks = sections
    .map((s) => `## ${s.heading}\n\n${s.body}`)
    .join('\n\n');
  return `# ${title}\n\n${blocks}\n`;
}

const DOCUMENTS = {
  protocols: {
    title: 'Keepers Adventures Protocols',
    content: sectionsToMarkdown('Club Protocols', [
      {
        heading: 'Convoy Discipline',
        body: 'Maintain radio contact on the assigned channel. Never overtake the lead vehicle. Signal hazards immediately. Keep visual contact with the vehicle behind you.',
      },
      {
        heading: 'Vehicle Readiness',
        body: 'All vehicles must arrive with a full tank, inflated spare, recovery points, sand ladders or equivalent, first-aid kit and sufficient water for every occupant.',
      },
      {
        heading: 'Member Conduct',
        body: 'Respect terrain, wildlife and fellow keepers. No reckless driving, no littering, no unauthorized drone flights without guide approval.',
      },
      {
        heading: 'Cancellation',
        body: 'Cancel registrations at least 24 hours before departure unless emergency conditions apply. Repeated no-shows may affect future booking priority.',
      },
    ]),
  },
  'safety-briefing': {
    title: 'Safety Briefing & Disclaimer',
    content: sectionsToMarkdown('Safety Briefing & Disclaimer', [
      {
        heading: 'Inherent Risk',
        body: 'Off-road adventure involves inherent risk including vehicle damage, injury or extreme weather. Participation is voluntary and at your own risk.',
      },
      {
        heading: 'Medical Fitness',
        body: 'Members must disclose relevant medical conditions privately to guides. Carry personal medication. Emergency contacts must be current in your profile.',
      },
      {
        heading: 'Recovery & Assistance',
        body: 'Follow guide instructions during recoveries. Never stand in the path of a winch line. Use rated recovery gear only.',
      },
      {
        heading: 'Disclaimer',
        body: 'Keepers Adventures 4x4, its organizers and partners are not liable for personal injury, loss or vehicle damage arising from participation, except where prohibited by law.',
      },
    ]),
  },
  brochure: {
    title: 'Keepers Adventures Brochure',
    content: `# Club Brochure

Keepers Adventures 4x4 is an exclusive members collective for precision off-road expeditions across the UAE and beyond.

## Highlights

- Curated desert, mountain and night expeditions
- Professional guides and recovery support
- Members directory and private community
- Workshops, briefings and annual gala
- Partner benefits with premium gear brands

## Membership

Membership is invitation-based and subject to vehicle readiness and conduct standards. Junior, Intermediate and Advanced tiers unlock priority registration and exclusive events.
`,
  },
  terms: {
    title: 'Terms of Service',
    content: `# Terms & Conditions

## Overview

These Terms & Conditions govern membership and participation in Keepers Adventures 4x4 expeditions, events, workshops and related club services. By creating an account or joining an adventure you agree to follow these terms and all published club protocols.

## Membership

Membership is subject to approval, vehicle readiness and conduct standards. Keepers may suspend or revoke access for unsafe driving, repeated no-shows, harassment or breach of convoy rules. Membership tiers (Junior, Intermediate, Advanced) determine which expeditions you may register for.

## Participation & cancellation

Adventure registration is binding once confirmed. Cancel at least 24 hours before departure unless an emergency applies. Participants must arrive on time with required recovery gear, water and a roadworthy 4x4. Guides may refuse departure if safety standards are not met.

## Liability & conduct

Off-road activity carries inherent risk. Members participate voluntarily and are responsible for their vehicle, passengers and personal equipment. Reckless driving, littering and unauthorized drone use are prohibited. Contact hello@keepersadventures.ae for membership or legal questions.
`,
  },
  privacy: {
    title: 'Privacy Policy',
    content: `# Privacy Policy

## Overview

Keepers Adventures 4x4 respects member privacy. This policy explains what information we collect in the app, why we use it, and the choices available to you.

## Information we collect

We collect account details (name, email, phone), profile and vehicle information you provide, expedition registrations, notification preferences, and basic device settings such as display mode. Emergency contacts are stored so guides can reach the right person if needed.

## How information is used

We use your data to authenticate membership, manage trip registrations, send trip and club notifications, operate the members directory according to your privacy settings, and improve expedition safety and operations.

## Your choices

You may update profile details, notification preferences and privacy controls in Settings. You may request account deletion from the club administration. For privacy requests email hello@keepersadventures.ae.
`,
  },
};

const TRIPS = [
  {
    demoKey: 'demo-trip-liwa-dawn',
    title: 'Liwa Dawn Expedition',
    description:
      'Traverse the towering red dunes of Liwa Oasis at first light. A cinematic desert run reserved for capable 4x4s and experienced keepers.',
    destination: 'Liwa Oasis, Abu Dhabi',
    meetingPoint: 'Al Ain Road Rest Area · Gate 3',
    date: '2026-11-22',
    time: '05:30',
    difficulty: 'Advanced',
    tripType: 'Desert Expedition',
    requiredMembership: 'advanced',
    minTripsRequired: 2,
    cover: 'trips/liwa.jpg',
    gallery: ['trips/liwa.jpg', 'trips/empty-quarter.jpg', 'trips/night-drive.jpg'],
    maxParticipants: 18,
    vehicleRequirements: 'Low-range 4x4 · All-terrains · Recovery points · Full tank',
    instructions:
      'Arrive 20 minutes early. Convoy radios on channel 7. Carry 10L water per person and desert recovery kit.',
    locationLabel: 'Liwa Oasis, Abu Dhabi',
    latitude: 23.1332,
    longitude: 53.7809,
    organizerUsername: 'demo.khalid.r',
    routeSummary: 'Liwa South Ridge → Moreeb Dune → Oasis Camp',
    status: 'published',
  },
  {
    demoKey: 'demo-trip-hatta-traverse',
    title: 'Hatta Mountain Traverse',
    description:
      'Technical mountain trails, wadi crossings and elevated viewpoints across the Hatta highlands.',
    destination: 'Hatta, Dubai',
    meetingPoint: 'Hatta Dam Parking',
    date: '2026-12-05',
    time: '07:00',
    difficulty: 'Moderate',
    tripType: 'Mountain Traverse',
    requiredMembership: 'intermediate',
    minTripsRequired: 1,
    cover: 'trips/hatta.jpg',
    gallery: ['trips/hatta.jpg', 'trips/jebel.jpg'],
    maxParticipants: 20,
    vehicleRequirements: 'High clearance 4x4 · A/T tires recommended',
    instructions: 'Helmets optional for open vehicles. Convoy leader briefing at 06:45.',
    locationLabel: 'Hatta Dam Parking, Dubai',
    latitude: 24.7965,
    longitude: 56.1143,
    organizerUsername: 'demo.omar.f',
    routeSummary: 'Dam Trail → Wadi Qahfi → Ridge Overlook',
    status: 'published',
  },
  {
    demoKey: 'demo-trip-fossil-night',
    title: 'Fossil Rock Night Drive',
    description:
      'Under a clear desert sky, navigate Fossil Rock formations with guided night protocols.',
    destination: 'Fossil Rock, Sharjah',
    meetingPoint: 'Mleiha Visitor Center',
    date: '2026-11-29',
    time: '18:30',
    difficulty: 'Easy',
    tripType: 'Night Drive',
    requiredMembership: 'junior',
    minTripsRequired: 0,
    cover: 'trips/fossil.jpg',
    gallery: ['trips/fossil.jpg', 'trips/night-drive.jpg'],
    maxParticipants: 24,
    vehicleRequirements: 'Any 4x4 · Working lights · Full spare',
    instructions: 'Night driving lights mandatory. No music during convoy segments.',
    locationLabel: 'Mleiha Visitor Center, Sharjah',
    latitude: 25.1236,
    longitude: 55.7914,
    organizerUsername: 'demo.khalid.r',
    routeSummary: 'Mleiha → Fossil Ridge → Star Camp',
    status: 'published',
  },
  {
    demoKey: 'demo-trip-jebel-jais',
    title: 'Jebel Jais Ascent',
    description:
      'High-altitude switchbacks and panoramic summit runs for skilled mountain drivers.',
    destination: 'Jebel Jais, Ras Al Khaimah',
    meetingPoint: 'Jais Base Camp Lot',
    date: '2026-10-12',
    time: '06:00',
    difficulty: 'Expert',
    tripType: 'Mountain Traverse',
    requiredMembership: 'advanced',
    minTripsRequired: 4,
    cover: 'trips/jebel.jpg',
    gallery: ['trips/jebel.jpg'],
    maxParticipants: 12,
    vehicleRequirements: 'Locked differentials preferred · Mountain recovery kit',
    instructions: 'Weather dependent. Abort protocol if winds exceed 45 km/h.',
    locationLabel: 'Jebel Jais Base Camp, Ras Al Khaimah',
    latitude: 25.9535,
    longitude: 56.1526,
    organizerUsername: 'demo.khalid.r',
    routeSummary: 'Base → Mid Ridge → Summit Point',
    status: 'completed',
  },
  {
    demoKey: 'demo-trip-empty-quarter',
    title: 'Empty Quarter Crossing',
    description:
      "A multi-stage Rub' al Khali dune crossing for elite keepers seeking the ultimate desert challenge.",
    destination: 'Empty Quarter Border Zone',
    meetingPoint: 'Seih Al Salam Muster',
    date: '2027-01-18',
    time: '04:45',
    difficulty: 'Expert',
    tripType: 'Crossing',
    requiredMembership: 'advanced',
    minTripsRequired: 8,
    cover: 'trips/empty-quarter.jpg',
    gallery: ['trips/empty-quarter.jpg', 'trips/liwa.jpg'],
    maxParticipants: 10,
    vehicleRequirements: 'Desert-prepped 4x4 · Dual spare · Satellite comms',
    instructions: 'Mandatory pre-trip briefing one week prior. Medical waiver required.',
    locationLabel: 'Seih Al Salam Muster, Empty Quarter',
    latitude: 22.9747,
    longitude: 52.9481,
    organizerUsername: 'demo.khalid.r',
    routeSummary: 'Seih Al Salam → Deep Dunes → Border Camp',
    status: 'published',
  },
];

const MEMBERS = [
  {
    email: 'demo.jovany@keepers.ae',
    username: 'demo.jovany.ortiz',
    firstName: 'Jovany',
    lastName: 'Ortiz',
    phone: '+971 50 123 4567',
    nationality: 'United Arab Emirates',
    gender: 'Male',
    bio: `${DEMO_MARKER} Founding keeper focused on dune navigation and convoy discipline.`,
    membership: 'advanced',
    completedTrips: 3,
    avatar: 'placeholders/jovany-ortiz.jpg',
    vehicle: {
      manufacturer: 'Jeep',
      model: 'Wrangler Rubicon',
      year: '2024',
      vin: 'DEMO-JOVANY-001',
      image: 'vehicles/primary.jpg',
    },
    social: {
      instagram: '@jovany.ortiz',
      facebook: 'Jovany Ortiz',
      tiktok: '@jovany4x4',
    },
    emergency: '+971 55 987 6543',
  },
  {
    email: 'demo.sara.n@keepers.ae',
    username: 'demo.sara.n',
    firstName: 'Sara',
    lastName: 'Nasser',
    phone: '+971 50 222 1001',
    nationality: 'United Arab Emirates',
    gender: 'Female',
    bio: `${DEMO_MARKER} Mountain trails and weekend convoy regular.`,
    membership: 'intermediate',
    completedTrips: 2,
    avatar: 'gallery/08-empty.jpg',
    vehicle: {
      manufacturer: 'Toyota',
      model: 'Land Cruiser 300',
      year: '2023',
      vin: 'DEMO-SARA-001',
      image: 'trips/hatta.jpg',
    },
    social: { instagram: '@sara.nasser' },
    emergency: '+971 55 222 1001',
  },
  {
    email: 'demo.hassan.r@keepers.ae',
    username: 'demo.hassan.r',
    firstName: 'Hassan',
    lastName: 'Rahman',
    phone: '+971 50 222 1002',
    nationality: 'United Arab Emirates',
    gender: 'Male',
    bio: `${DEMO_MARKER} Recovery specialist and night-drive enthusiast.`,
    membership: 'advanced',
    completedTrips: 5,
    avatar: 'gallery/03-hatta.jpg',
    vehicle: {
      manufacturer: 'Nissan',
      model: 'Patrol Nismo',
      year: '2022',
      vin: 'DEMO-HASSAN-001',
      image: 'trips/liwa.jpg',
    },
    social: { instagram: '@hassan.r', tiktok: '@hassan4x4' },
    emergency: '+971 55 222 1002',
  },
  {
    email: 'demo.maya.k@keepers.ae',
    username: 'demo.maya.k',
    firstName: 'Maya',
    lastName: 'Khalid',
    phone: '+971 50 222 1003',
    nationality: 'United Kingdom',
    gender: 'Female',
    bio: `${DEMO_MARKER} New member building confidence on graded desert routes.`,
    membership: 'junior',
    completedTrips: 0,
    avatar: 'gallery/04-liwa.jpg',
    vehicle: {
      manufacturer: 'Jeep',
      model: 'Gladiator Mojave',
      year: '2024',
      vin: 'DEMO-MAYA-001',
      image: 'trips/fossil.jpg',
    },
    social: { instagram: '@maya.k' },
    emergency: '+971 55 222 1003',
  },
  {
    email: 'demo.omar.f@keepers.ae',
    username: 'demo.omar.f',
    firstName: 'Omar',
    lastName: 'Faris',
    phone: '+971 50 222 1004',
    nationality: 'Jordan',
    gender: 'Male',
    bio: `${DEMO_MARKER} Photography-led expeditions and ridge overlook runs.`,
    membership: 'intermediate',
    completedTrips: 2,
    avatar: 'gallery/07-fossil.jpg',
    vehicle: {
      manufacturer: 'Ford',
      model: 'Bronco Raptor',
      year: '2023',
      vin: 'DEMO-OMAR-001',
      image: 'trips/jebel.jpg',
    },
    social: { facebook: 'Omar Faris', instagram: '@omar.f' },
    emergency: '+971 55 222 1004',
  },
  {
    email: 'demo.nora.ellis@keepers.ae',
    username: 'demo.nora.ellis',
    firstName: 'Nora',
    lastName: 'Ellis',
    phone: '+971 50 222 1005',
    nationality: 'United States',
    gender: 'Female',
    bio: `${DEMO_MARKER} Documenting Keepers journeys and campfire evenings.`,
    membership: 'junior',
    completedTrips: 1,
    avatar: 'gallery/06-jebel.jpg',
    vehicle: {
      manufacturer: 'Toyota',
      model: 'Prado VX',
      year: '2021',
      vin: 'DEMO-NORA-001',
      image: 'trips/night-drive.jpg',
    },
    social: { instagram: '@nora.ellis', tiktok: '@nora.ontrail' },
    emergency: '+971 55 222 1005',
  },
  {
    email: 'demo.khalid.r@keepers.ae',
    username: 'demo.khalid.r',
    firstName: 'Khalid',
    lastName: 'Rahman',
    phone: '+971 50 333 4455',
    nationality: 'United Arab Emirates',
    gender: 'Male',
    bio: `${DEMO_MARKER} Club director and high-altitude route planner.`,
    membership: 'advanced',
    completedTrips: 12,
    avatar: 'gallery/09-brand.jpg',
    vehicle: {
      manufacturer: 'Land Rover',
      model: 'Defender 110',
      year: '2024',
      vin: 'DEMO-KHALID-001',
      image: 'trips/empty-quarter.jpg',
    },
    social: { instagram: '@khalid.keepers' },
    emergency: '+971 55 333 4455',
    role: 'marshall',
  },
];

const SPONSORS = [
  { name: 'Jeep', logo: 'jeep', url: 'https://www.jeep.com', order: 1 },
  { name: 'Toyota', logo: 'toyota', url: 'https://www.toyota.com', order: 2 },
  { name: 'Ford', logo: 'ford', url: 'https://www.ford.com', order: 3 },
  { name: 'Nissan', logo: 'nissan', url: 'https://www.nissanusa.com', order: 4 },
  { name: 'Hyundai', logo: 'hyundai', url: 'https://www.hyundai.com', order: 5 },
  { name: 'Kia', logo: 'kia', url: 'https://www.kia.com', order: 6 },
];

const ANNOUNCEMENTS = [
  {
    title: 'Winter Expedition Calendar Released',
    body: 'Five signature desert and mountain adventures are now open for registration.',
  },
  {
    title: 'New Recovery Kit Standard',
    body: 'All registered vehicles must carry the updated Keepers recovery checklist from December.',
  },
  {
    title: 'Welcome 24 New Keepers',
    body: 'Our community continues to grow — introduce yourself in the members lounge.',
  },
];

const EVENTS = [
  {
    title: 'Members Night Drive Briefing',
    date: '2026-11-18',
    location: 'Keepers HQ, Dubai',
    image: 'events/meetup.jpg',
    description: 'Protocol refresher and convoy briefing for the Fossil Rock night run.',
  },
  {
    title: 'Recovery Workshop',
    date: '2026-11-25',
    location: 'Al Qudra Training Grounds',
    image: 'events/workshop.jpg',
    description: 'Hands-on winch, kinetic rope and sand ladder masterclass.',
  },
  {
    title: 'Annual Keepers Gala',
    date: '2026-12-20',
    location: 'Desert Resort Pavilion',
    image: 'events/gala.jpg',
    description: 'Exclusive evening celebrating a year of expeditions and partnerships.',
  },
];

const GALLERY = [
  { file: 'gallery/01-home.jpg', caption: 'Golden convoy · mountains', order: 1 },
  { file: 'gallery/02-auth.jpg', caption: 'Dune slide · Rubicon', order: 2 },
  { file: 'gallery/03-hatta.jpg', caption: 'Wadi crossing', order: 3 },
  { file: 'gallery/04-liwa.jpg', caption: 'Desert crest', order: 4 },
  { file: 'gallery/05-night.jpg', caption: 'Night trail lights', order: 5 },
  { file: 'gallery/06-jebel.jpg', caption: 'Coastal convoy', order: 6 },
  { file: 'gallery/07-fossil.jpg', caption: 'Shoreline trail', order: 7 },
  { file: 'gallery/08-empty.jpg', caption: 'Camels on trail', order: 8 },
  { file: 'gallery/09-brand.jpg', caption: 'Keepers mark', order: 9 },
];

async function ensureAuthUser({ email, password, metadata }) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (data?.user?.id) return data.user.id;

  // Already exists — locate by paging users (service role).
  if (error && /already|registered|exists/i.test(error.message || '')) {
    for (let page = 1; page <= 10; page += 1) {
      const listed = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (listed.error) throw listed.error;
      const found = (listed.data?.users || []).find(
        (u) => (u.email || '').toLowerCase() === email.toLowerCase(),
      );
      if (found) return found.id;
      if ((listed.data?.users || []).length < 200) break;
    }
  }

  throw new Error(`Auth create failed for ${email}: ${error?.message || 'unknown'}`);
}

async function main() {
  console.log('=== Keepers demo content seed ===');
  console.log('RN assets root:', ASSETS);

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const summary = {
    uploads: 0,
    members: 0,
    trips: 0,
    tripMedia: 0,
    sponsors: 0,
    heroes: 0,
    gallery: 0,
    announcements: 0,
    events: 0,
    documents: 0,
  };

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.demo_seed_keys (
        demo_key TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id UUID,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const levels = await client.query(`SELECT id, code FROM membership_levels`);
    const levelByCode = Object.fromEntries(levels.rows.map((r) => [r.code, r.id]));
    const roles = await client.query(`SELECT id, code FROM roles`);
    const roleByCode = Object.fromEntries(roles.rows.map((r) => [r.code, r.id]));

    // ---- Members ----
    const memberIds = {};
    for (const m of MEMBERS) {
      const userId = await ensureAuthUser({
        email: m.email,
        password: DEMO_PASSWORD,
        metadata: {
          first_name: m.firstName,
          last_name: m.lastName,
          username: m.username,
          demo: true,
        },
      });

      const avatarUp = await upload(
        'avatars',
        `demo/${m.username}/avatar.jpg`,
        asset(...m.avatar.split('/')),
      );
      summary.uploads += 1;
      const vehicleUp = await upload(
        'vehicles',
        `demo/${m.username}/vehicle.jpg`,
        asset(...m.vehicle.image.split('/')),
      );
      summary.uploads += 1;

      await client.query(
        `INSERT INTO member_profiles (
           id, first_name, last_name, username, email, phone, nationality, gender, bio,
           avatar_url, membership_level_id, completed_trips, status, approved_at, agreement_accepted_at,
           privacy_show_vehicle, privacy_show_social
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'approved', NOW(), NOW(), TRUE, TRUE
         )
         ON CONFLICT (id) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           username = EXCLUDED.username,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           nationality = EXCLUDED.nationality,
           gender = EXCLUDED.gender,
           bio = EXCLUDED.bio,
           avatar_url = EXCLUDED.avatar_url,
           membership_level_id = EXCLUDED.membership_level_id,
           completed_trips = EXCLUDED.completed_trips,
           status = 'approved',
           approved_at = COALESCE(member_profiles.approved_at, NOW()),
           deleted_at = NULL`,
        [
          userId,
          m.firstName,
          m.lastName,
          m.username,
          m.email.toLowerCase(),
          m.phone,
          m.nationality,
          m.gender,
          m.bio,
          avatarUp.publicUrl,
          levelByCode[m.membership] || null,
          m.completedTrips,
        ],
      );

      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, roleByCode.member],
      );
      if (m.role && roleByCode[m.role]) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, roleByCode[m.role]],
        );
      }

      await client.query(
        `INSERT INTO notification_preferences (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId],
      );

      const existingVehicle = await client.query(
        `SELECT id FROM vehicles WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
        [userId],
      );
      if (existingVehicle.rows[0]) {
        await client.query(
          `UPDATE vehicles SET
             manufacturer = $1, model = $2, model_year = $3, vin = $4, image_url = $5, is_primary = TRUE
           WHERE id = $6`,
          [
            m.vehicle.manufacturer,
            m.vehicle.model,
            m.vehicle.year,
            m.vehicle.vin,
            vehicleUp.publicUrl,
            existingVehicle.rows[0].id,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO vehicles (user_id, manufacturer, model, model_year, vin, image_url, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
          [
            userId,
            m.vehicle.manufacturer,
            m.vehicle.model,
            m.vehicle.year,
            m.vehicle.vin,
            vehicleUp.publicUrl,
          ],
        );
      }

      for (const [platform, handle] of Object.entries(m.social || {})) {
        await client.query(
          `INSERT INTO social_links (user_id, platform, handle_or_url)
           VALUES ($1,$2,$3)
           ON CONFLICT (user_id, platform) DO UPDATE SET handle_or_url = EXCLUDED.handle_or_url`,
          [userId, platform, handle],
        );
      }

      const ec = await client.query(
        `SELECT id FROM emergency_contacts WHERE user_id = $1 ORDER BY created_at LIMIT 1`,
        [userId],
      );
      if (ec.rows[0]) {
        await client.query(
          `UPDATE emergency_contacts SET phone = $1, name = $2, relationship = 'Emergency'
           WHERE id = $3`,
          [m.emergency, `${m.firstName} emergency`, ec.rows[0].id],
        );
      } else {
        await client.query(
          `INSERT INTO emergency_contacts (user_id, name, phone, relationship)
           VALUES ($1,$2,$3,'Emergency')`,
          [userId, `${m.firstName} emergency`, m.emergency],
        );
      }

      memberIds[m.username] = userId;
      summary.members += 1;
      console.log('member ok:', m.username);
    }

    // ---- Trips ----
    const tripIds = {};
    for (const t of TRIPS) {
      const coverUp = await upload(
        'trips',
        `demo/${t.demoKey}/cover.jpg`,
        asset(...t.cover.split('/')),
      );
      summary.uploads += 1;

      const existingKey = await client.query(
        `SELECT entity_id FROM demo_seed_keys WHERE demo_key = $1`,
        [t.demoKey],
      );

      let tripId = existingKey.rows[0]?.entity_id || null;
      if (!tripId) {
        const byTitle = await client.query(
          `SELECT id FROM trips WHERE title = $1 AND trip_date = $2 AND deleted_at IS NULL LIMIT 1`,
          [t.title, t.date],
        );
        tripId = byTitle.rows[0]?.id || null;
      }

      const organizerId = memberIds[t.organizerUsername] || null;
      const levelId = levelByCode[t.requiredMembership] || null;

      if (tripId) {
        await client.query(
          `UPDATE trips SET
             title = $1, description = $2, destination = $3, meeting_point = $4,
             trip_date = $5, trip_time = $6, difficulty = $7, trip_type = $8,
             required_membership_level_id = $9, min_trips_required = $10,
             cover_image_url = $11, max_participants = $12, vehicle_requirements = $13,
             instructions = $14, route_summary = $15, location_label = $16,
             latitude = $17, longitude = $18, organizer_id = $19, status = $20,
             published_at = COALESCE(published_at, CASE WHEN $20 = 'published' THEN NOW() ELSE NULL END),
             deleted_at = NULL
           WHERE id = $21`,
          [
            t.title,
            t.description,
            t.destination,
            t.meetingPoint,
            t.date,
            t.time,
            t.difficulty,
            t.tripType,
            levelId,
            t.minTripsRequired,
            coverUp.publicUrl,
            t.maxParticipants,
            t.vehicleRequirements,
            t.instructions,
            t.routeSummary,
            t.locationLabel,
            t.latitude,
            t.longitude,
            organizerId,
            t.status,
            tripId,
          ],
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO trips (
             title, description, destination, meeting_point, trip_date, trip_time,
             difficulty, trip_type, required_membership_level_id, min_trips_required,
             cover_image_url, max_participants, vehicle_requirements, instructions,
             route_summary, location_label, latitude, longitude, organizer_id,
             created_by, status, published_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,$20,
             CASE WHEN $20 = 'published' THEN NOW() ELSE NULL END
           ) RETURNING id`,
          [
            t.title,
            t.description,
            t.destination,
            t.meetingPoint,
            t.date,
            t.time,
            t.difficulty,
            t.tripType,
            levelId,
            t.minTripsRequired,
            coverUp.publicUrl,
            t.maxParticipants,
            t.vehicleRequirements,
            t.instructions,
            t.routeSummary,
            t.locationLabel,
            t.latitude,
            t.longitude,
            organizerId,
            t.status,
          ],
        );
        tripId = inserted.rows[0].id;
      }

      await client.query(
        `INSERT INTO demo_seed_keys (demo_key, entity_type, entity_id, notes)
         VALUES ($1,'trip',$2,$3)
         ON CONFLICT (demo_key) DO UPDATE SET
           entity_id = EXCLUDED.entity_id,
           notes = EXCLUDED.notes,
           updated_at = NOW()`,
        [t.demoKey, tripId, t.title],
      );

      await client.query(
        `UPDATE trip_media SET deleted_at = NOW()
         WHERE trip_id = $1 AND storage_path LIKE 'demo/%' AND deleted_at IS NULL`,
        [tripId],
      );

      let order = 0;
      for (const g of t.gallery) {
        const up = await upload(
          'trips',
          `demo/${t.demoKey}/gallery-${order}.jpg`,
          asset(...g.split('/')),
        );
        summary.uploads += 1;
        await client.query(
          `INSERT INTO trip_media (trip_id, media_type, storage_path, public_url, display_order, uploaded_by)
           VALUES ($1,'image',$2,$3,$4,$5)`,
          [tripId, up.storagePath, up.publicUrl, order, organizerId],
        );
        summary.tripMedia += 1;
        order += 1;
      }

      tripIds[t.demoKey] = tripId;
      summary.trips += 1;
      console.log('trip ok:', t.title);
    }

    // ---- Hero slides ----
    await client.query(
      `UPDATE hero_slides SET is_active = FALSE
       WHERE title IN (
         'LIWA DAWN EXPEDITION',
         'FOSSIL ROCK NIGHT DRIVE',
         'EMPTY QUARTER CROSSING',
         'ANNUAL KEEPERS GALA'
       )`,
    );

    const heroes = [
      {
        key: 'demo-hero-liwa',
        title: 'LIWA DAWN EXPEDITION',
        subtitle: 'Towering red dunes at first light · Registration open',
        image: 'trips/liwa.jpg',
        tripKey: 'demo-trip-liwa-dawn',
        order: 1,
      },
      {
        key: 'demo-hero-fossil',
        title: 'FOSSIL ROCK NIGHT DRIVE',
        subtitle: 'Guided night protocols under clear desert skies',
        image: 'trips/fossil.jpg',
        tripKey: 'demo-trip-fossil-night',
        order: 2,
      },
      {
        key: 'demo-hero-empty',
        title: 'EMPTY QUARTER CROSSING',
        subtitle: 'Elite multi-stage Rub’ al Khali challenge',
        image: 'trips/empty-quarter.jpg',
        tripKey: 'demo-trip-empty-quarter',
        order: 3,
      },
      {
        key: 'demo-hero-gala',
        title: 'ANNUAL KEEPERS GALA',
        subtitle: 'Celebrate a year of expeditions and partnerships',
        image: 'events/gala.jpg',
        tripKey: null,
        order: 4,
      },
    ];

    for (const h of heroes) {
      const up = await upload(
        'gallery',
        `demo/heroes/${h.key}.jpg`,
        asset(...h.image.split('/')),
      );
      summary.uploads += 1;
      const existing = await client.query(
        `SELECT entity_id FROM demo_seed_keys WHERE demo_key = $1`,
        [h.key],
      );
      let id = existing.rows[0]?.entity_id || null;
      const tripId = h.tripKey ? tripIds[h.tripKey] : null;
      if (id) {
        await client.query(
          `UPDATE hero_slides SET
             title=$1, subtitle=$2, image_url=$3, trip_id=$4, display_order=$5, is_active=TRUE
           WHERE id=$6`,
          [h.title, h.subtitle, up.publicUrl, tripId, h.order, id],
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO hero_slides (title, subtitle, image_url, trip_id, display_order, is_active)
           VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id`,
          [h.title, h.subtitle, up.publicUrl, tripId, h.order],
        );
        id = inserted.rows[0].id;
      }
      await client.query(
        `INSERT INTO demo_seed_keys (demo_key, entity_type, entity_id, notes)
         VALUES ($1,'hero_slide',$2,$3)
         ON CONFLICT (demo_key) DO UPDATE SET entity_id = EXCLUDED.entity_id, updated_at = NOW()`,
        [h.key, id, h.title],
      );
      summary.heroes += 1;
    }
    console.log('hero slides ok');

    // ---- Gallery ----
    for (const g of GALLERY) {
      const key = `demo-gallery-${g.order}`;
      const up = await upload(
        'gallery',
        `demo/gallery/${String(g.order).padStart(2, '0')}.jpg`,
        asset(...g.file.split('/')),
      );
      summary.uploads += 1;
      const existing = await client.query(
        `SELECT entity_id FROM demo_seed_keys WHERE demo_key = $1`,
        [key],
      );
      let id = existing.rows[0]?.entity_id || null;
      if (id) {
        await client.query(
          `UPDATE gallery_items SET
             image_url=$1, caption=$2, display_order=$3, is_active=TRUE, deleted_at=NULL
           WHERE id=$4`,
          [up.publicUrl, g.caption, g.order, id],
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO gallery_items (image_url, caption, display_order, is_active)
           VALUES ($1,$2,$3,TRUE) RETURNING id`,
          [up.publicUrl, g.caption, g.order],
        );
        id = inserted.rows[0].id;
      }
      await client.query(
        `INSERT INTO demo_seed_keys (demo_key, entity_type, entity_id, notes)
         VALUES ($1,'gallery_item',$2,$3)
         ON CONFLICT (demo_key) DO UPDATE SET entity_id = EXCLUDED.entity_id, updated_at = NOW()`,
        [key, id, g.caption],
      );
      summary.gallery += 1;
    }
    console.log('gallery ok');

    // ---- Sponsors (logo_url stores brand slug for mobile SponsorBrandMark) ----
    for (const s of SPONSORS) {
      const existing = await client.query(
        `SELECT id FROM sponsors WHERE lower(name) = lower($1) AND deleted_at IS NULL LIMIT 1`,
        [s.name],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE sponsors SET
             logo_url=$1, website_url=$2, display_order=$3, is_active=TRUE, deleted_at=NULL
           WHERE id=$4`,
          [s.logo, s.url, s.order, existing.rows[0].id],
        );
      } else {
        await client.query(
          `INSERT INTO sponsors (name, logo_url, website_url, display_order, is_active)
           VALUES ($1,$2,$3,$4,TRUE)`,
          [s.name, s.logo, s.url, s.order],
        );
      }
      summary.sponsors += 1;
    }
    console.log('sponsors ok');

    // ---- Announcements ----
    for (const a of ANNOUNCEMENTS) {
      const existing = await client.query(
        `SELECT id FROM announcements WHERE title = $1 AND deleted_at IS NULL LIMIT 1`,
        [a.title],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE announcements SET
             body=$1, status='published', published_at=COALESCE(published_at, NOW()), deleted_at=NULL
           WHERE id=$2`,
          [a.body, existing.rows[0].id],
        );
      } else {
        await client.query(
          `INSERT INTO announcements (title, body, target_audience, status, published_at)
           VALUES ($1,$2,'all','published', NOW())`,
          [a.title, a.body],
        );
      }
      summary.announcements += 1;
    }
    console.log('announcements ok');

    // ---- Events ----
    for (const e of EVENTS) {
      const up = await upload(
        'gallery',
        `demo/events/${e.title.toLowerCase().replace(/\s+/g, '-')}.jpg`,
        asset(...e.image.split('/')),
      );
      summary.uploads += 1;
      const existing = await client.query(
        `SELECT id FROM events WHERE title = $1 AND event_date = $2 AND deleted_at IS NULL LIMIT 1`,
        [e.title, e.date],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE events SET
             description=$1, location=$2, image_url=$3, status='scheduled', deleted_at=NULL
           WHERE id=$4`,
          [e.description, e.location, up.publicUrl, existing.rows[0].id],
        );
      } else {
        await client.query(
          `INSERT INTO events (title, description, event_date, location, image_url, status)
           VALUES ($1,$2,$3,$4,$5,'scheduled')`,
          [e.title, e.description, e.date, e.location, up.publicUrl],
        );
      }
      summary.events += 1;
    }
    console.log('events ok');

    // ---- Documents (update stub placeholders with demo copy) ----
    for (const [slug, doc] of Object.entries(DOCUMENTS)) {
      const res = await client.query(
        `UPDATE documents SET
           title = $1,
           content = $2,
           document_type = 'text',
           is_published = TRUE,
           version = 'demo-1.0',
           updated_at = NOW()
         WHERE slug = $3
         RETURNING id`,
        [doc.title, doc.content, slug],
      );
      if (res.rowCount) summary.documents += 1;
    }
    console.log('documents ok');

    // Club story settings (optional app_settings keys)
    await client.query(
      `INSERT INTO app_settings (key, value, description) VALUES
         ('club_story', $1::jsonb, 'Demo club about/mission/vision/contact'),
         ('app_name', '"Keepers Adventures 4x4"'::jsonb, 'Application display name')
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [
        JSON.stringify({
          about:
            'Keepers Adventures 4x4 is an exclusive off-road collective built for those who treat the desert as cathedral and the machine as instrument. We craft expeditions that are precise, cinematic and unforgettable.',
          mission:
            'To unite exceptional drivers through meticulously designed adventures that elevate skill, camaraderie and respect for the terrain.',
          vision:
            'Become the defining private 4x4 adventure society of the region — where technology, craftsmanship and wilderness converge.',
          contact: {
            email: 'hello@keepersadventures.ae',
            phone: '+971 4 555 0190',
            address: 'Keepers HQ · Al Quoz Creative Zone, Dubai, UAE',
            website: 'www.keepersadventures.ae',
          },
        }),
      ],
    );

    console.log('\n=== Seed complete ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log('\nDemo member password (all demo.* accounts):', DEMO_PASSWORD);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('SEED FAILED:', err.message || err);
  process.exit(1);
});
