require('dotenv').config();
const { Client } = require('pg');
const https = require('https');
const http = require('http');

function head(url) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, { method: 'HEAD', timeout: 12000 }, (res) => {
        resolve(res.statusCode);
      });
      req.on('error', () => resolve('ERR'));
      req.on('timeout', () => {
        req.destroy();
        resolve('TIMEOUT');
      });
      req.end();
    } catch {
      resolve('EX');
    }
  });
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.database_url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const counts = await client.query(`
    select 'trips' t, count(*)::int n from trips where deleted_at is null
    union all select 'published_future_trips', count(*)::int from trips
      where status='published' and deleted_at is null and trip_date >= CURRENT_DATE
    union all select 'sponsors', count(*)::int from sponsors where deleted_at is null and is_active
    union all select 'heroes', count(*)::int from hero_slides where is_active
    union all select 'gallery', count(*)::int from gallery_items where is_active and deleted_at is null
    union all select 'announcements', count(*)::int from announcements where status='published' and deleted_at is null
    union all select 'events', count(*)::int from events where deleted_at is null
    union all select 'demo_members', count(*)::int from member_profiles where username like 'demo.%' and deleted_at is null
  `);
  console.log('COUNTS');
  for (const r of counts.rows) console.log(`  ${r.t}: ${r.n}`);

  const trips = await client.query(`
    select title, status, trip_date::text as trip_date,
           (cover_image_url is not null) as has_cover,
           (select count(*)::int from trip_media tm where tm.trip_id=t.id and tm.deleted_at is null) as media
    from trips t
    where title in (
      'Liwa Dawn Expedition','Hatta Mountain Traverse','Fossil Rock Night Drive',
      'Jebel Jais Ascent','Empty Quarter Crossing'
    )
    order by trip_date
  `);
  console.log('\nTRIPS');
  console.table(trips.rows);

  const heroes = await client.query(
    `select title, image_url from hero_slides where is_active order by display_order`,
  );
  console.log('\nHERO IMAGE HEADS');
  for (const h of heroes.rows) {
    console.log(`  ${await head(h.image_url)}  ${h.title}`);
  }

  const gallery = await client.query(
    `select caption, image_url from gallery_items where is_active and deleted_at is null order by display_order`,
  );
  console.log('\nGALLERY IMAGE HEADS');
  for (const g of gallery.rows) {
    console.log(`  ${await head(g.image_url)}  ${g.caption}`);
  }

  const sponsors = await client.query(
    `select name, logo_url, website_url from sponsors where deleted_at is null order by display_order`,
  );
  console.log('\nSPONSORS');
  console.table(sponsors.rows);

  const docs = await client.query(
    `select slug, title, length(content)::int as chars from documents order by slug`,
  );
  console.log('\nDOCUMENTS');
  console.table(docs.rows);

  const members = await client.query(`
    select username, first_name, last_name, status,
           (avatar_url is not null) as has_avatar,
           (
             select manufacturer || ' ' || model
             from vehicles v
             where v.user_id = m.id and v.deleted_at is null
             limit 1
           ) as vehicle
    from member_profiles m
    where username like 'demo.%'
    order by username
  `);
  console.log('\nDEMO MEMBERS');
  console.table(members.rows);

  const media = await client.query(
    `select public_url from trip_media where deleted_at is null order by created_at desc limit 5`,
  );
  console.log('\nTRIP MEDIA HEADS');
  for (const m of media.rows) {
    console.log(`  ${await head(m.public_url)}  ${m.public_url.slice(0, 90)}`);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
