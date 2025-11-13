#!/usr/bin/env node
import pool from "../Backend/db/pg.js";

async function pickUsers() {
  const { rows } = await pool.query(
    `SELECT id, firstname, lastname, email
       FROM userdata
      ORDER BY created_at ASC`
  );
  if (rows.length < 2) {
    throw new Error("Need at least two users in userdata to seed sample events.");
  }
  return {
    host: rows[0],
    invitee: rows[1],
  };
}

function sampleEvents(host) {
  const now = new Date();
  const future = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  return [
    {
      title: "Neighbourhood Kindness Coffee",
      category: "Community",
      cover_url: "/images/friendsHavingLunch.jpg",
      start_at: future.toISOString(),
      end_at: new Date(future.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      tz: "America/Vancouver",
      location_text: "Kind Grounds, Kitsilano, Vancouver",
      visibility: "public",
      capacity: 30,
      waitlist_enabled: true,
      description: "Drop in for warm drinks, postcard writing, and planning the next micro-kindness sprint.",
      attendance_methods: ["host_code", "social_proof"],
      status: "published",
    },
    {
      title: "Sunset Plog & Picnic",
      category: "Outdoors",
      cover_url: "/images/friendsOnBeach.jpg",
      start_at: later.toISOString(),
      end_at: new Date(later.getTime() + 90 * 60 * 1000).toISOString(),
      tz: "America/Vancouver",
      location_text: "Jericho Beach parking lot",
      visibility: "fof",
      capacity: 40,
      waitlist_enabled: true,
      description: "Grab gloves and bags, clean as a crew, then share gratitude stories over snacks.",
      attendance_methods: ["host_code", "social_proof"],
      status: "draft",
    },
  ].map((evt) => ({
    creator_user_id: host.id,
    reward_pool_kind: 25,
    ...evt,
  }));
}

async function insertEvent(event) {
  const { rows } = await pool.query(
    `
      INSERT INTO events (
        id, creator_user_id, title, category,
        start_at, end_at, tz, location_text,
        visibility, capacity, waitlist_enabled, cover_url,
        description, attendance_methods, reward_pool_kind,
        status
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14,
        $15
      )
      RETURNING id, title, status
    `,
    [
      event.creator_user_id,
      event.title,
      event.category,
      event.start_at,
      event.end_at,
      event.tz,
      event.location_text,
      event.visibility,
      event.capacity,
      event.waitlist_enabled,
      event.cover_url ?? null,
      event.description,
      JSON.stringify(event.attendance_methods),
      event.reward_pool_kind,
      event.status,
    ]
  );
  return rows[0];
}

async function insertInvite(eventId, senderId, recipient) {
  const { rows } = await pool.query(
    `
      INSERT INTO invites (
        id, event_id, sender_user_id, recipient_user_id, invitee_email, invitee_name, status
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, 'pending'
      )
      RETURNING id
    `,
    [eventId, senderId, recipient.id, recipient.email, `${recipient.firstname || ""} ${recipient.lastname || ""}`.trim() || recipient.email]
  );
  return rows[0];
}

async function main() {
  try {
    const { host, invitee } = await pickUsers();
    console.log(`[seed] Host: ${host.email} (id=${host.id})`);
    console.log(`[seed] Invitee: ${invitee.email} (id=${invitee.id})`);

    const events = sampleEvents(host);
    const inserted = [];
    for (const evt of events) {
      const record = await insertEvent(evt);
      console.log(`[seed] Inserted event "${record.title}" (${record.status}) -> ${record.id}`);
      inserted.push(record);
    }

    if (inserted.length) {
      await insertInvite(inserted[0].id, host.id, invitee);
      console.log(`[seed] Added invite for event ${inserted[0].id}`);
    }

    console.log("[seed] Done.");
  } catch (err) {
    console.error("[seed] Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
