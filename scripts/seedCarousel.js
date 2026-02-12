// scripts/seedCarousel.js
// Idempotent seeder for carousel_items. Upserts on seed_key.
import { source } from "framer-motion/client";
import pool from "../Backend/db/pg.js";

const ITEMS = [
  {
    seed_key: "crew-vancouver-beach-clean",
    type: "social_post",
    caption: "Kinder Crew wrapped a Saturday shoreline clean-up with fresh air and new friends.",
    title: "Shoreline Clean-Up",
    media_url: "/images/friendsOnBeach.jpg",
    link_url: "https://getkinder.ai/events/shoreline",
    author_name: "Kinder Crew Vancouver",
    city: "Vancouver",
    crew_label: "Vancouver",
    priority: 10,
    status: "active",
  },
  {
    seed_key: "crew-victoria-food-bank",
    type: "social_post",
    caption: "Food bank prep night—70 hampers packed in under two hours. Way to go, crew!",
    title: "Food Bank Prep",
    media_url: "/images/friendsHavingLunch.jpg",
    link_url: "https://getkinder.ai/events/foodbank",
    author_name: "Victoria Volunteers",
    city: "Victoria",
    crew_label: "Victoria",
    priority: 9,
    status: "active",
  },
  {
    seed_key: "crew-vancouver-park-stewards",
    type: "social_post",
    caption: "New park stewards practiced safety checks and tree wraps—first session done.",
    title: "Park Stewards",
    media_url: "/images/heart3D.png",
    link_url: "https://getkinder.ai/events/park-stewards",
    author_name: "City Stewards",
    city: "Vancouver",
    crew_label: "Vancouver",
    priority: 8,
    status: "active",
  },
  {
    seed_key: "crew-victoria-community-kitchen",
    type: "social_post",
    caption: "Community kitchen team served 120 meals—warm food, warmer welcomes.",
    title: "Community Kitchen",
    media_url: "/images/happyGirls.jpeg",
    link_url: "https://getkinder.ai/events/community-kitchen",
    author_name: "Kinder Kitchen Crew",
    city: "Victoria",
    crew_label: "Victoria",
    priority: 7,
    status: "active",
  },
  {
    seed_key: "crew-vancouver-gear-drive",
    type: "social_post",
    caption: "Winter gear drive sorted 15 boxes of coats and boots. Thank you donors!",
    title: "Gear Drive",
    media_url: "/images/friendsOnBeach.jpg",
    link_url: "https://getkinder.ai/events/gear-drive",
    author_name: "Vancouver Pods",
    city: "Vancouver",
    crew_label: "Pods",
    priority: 6,
    status: "active",
  },
  {
    seed_key: "crew-victoria-mentorship",
    type: "social_post",
    caption: "Mentorship circle matched three newcomers with study buddies this week.",
    title: "Mentorship Circle",
    media_url: "/images/friendsHavingLunch.jpg",
    link_url: "https://getkinder.ai/events/mentorship",
    author_name: "Kinder Mentors",
    city: "Victoria",
    crew_label: "Mentors",
    priority: 5,
    status: "active",
  },
  {
    seed_key: "crew-vancouver-wwh-picnic",
    type: "social_post",
    caption: "Volunteering at the WWH picnic was a blast!",
    title: "WWH Picnic",
    media_url: "/images/fari&jenny&michael.jpg",
    link_url: null,
    author_name: "Kinder Mentors",
    city: "Vancouver",
    crew_label: "Helping's Fun Crew",
    priority: 4,
    status: "active",
  },
];

async function main() {
  console.log("Seeding carousel_items…");
  const client = await pool.connect();
  try {
    for (const item of ITEMS) {
      const sql = `
        INSERT INTO carousel_items
          (seed_key, type, caption, title, media_url, link_url, author_name, city, crew_label, priority, status)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (seed_key) DO UPDATE
          SET type = EXCLUDED.type,
              caption = EXCLUDED.caption,
              title = EXCLUDED.title,
              media_url = EXCLUDED.media_url,
              link_url = EXCLUDED.link_url,
              author_name = EXCLUDED.author_name,
              city = EXCLUDED.city,
              crew_label = EXCLUDED.crew_label,
              priority = EXCLUDED.priority,
              status = EXCLUDED.status,
              updated_at = NOW();
      `;
      const params = [
        item.seed_key,
        item.type,
        item.caption,
        item.title,
        item.media_url,
        item.link_url,
        item.author_name,
        item.city,
        item.crew_label,
        item.priority,
        item.status,
      ];
      await client.query(sql, params);
      console.log(`Upserted carousel item ${item.seed_key}`);
    }
  } finally {
    client.release();
  }
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exitCode = 1;
});
