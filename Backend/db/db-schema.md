---
title: Get Kinder Database Schema
description: Documentation of all database tables, columns, indexes, and constraints for maintenance and troubleshooting.
last_updated: 2025-07-25
---

# Get Kinder DB Schema Handbook

_Last updated: **2025-07-25**_

## 0) Conventions & Tips

- **Naming**
  - Tables, columns, and indexes are **snake_case**.
  - Foreign keys are always `{referencing_table}.{referenced_table}_id`.
- **Primary keys** use `SERIAL PRIMARY KEY`.
- **Timestamps** default to `CURRENT_TIMESTAMP` when helpful.
- **Foreign keys** use `ON DELETE CASCADE` when child data should vanish if the parent is deleted (e.g., `user_badges` if a user is deleted).
- **Indexes**
  - Always index foreign keys.
  - Add **multi-column indexes** for your most common filters/joins.
- **Uniqueness**
  - Add **unique constraints** to prevent duplicates in log tables or link tables (e.g., `(user_id, badge_id)` in `user_badges`).

---

## 1) Quick Inventory

| Table              | Purpose                                                                 |
|--------------------|-------------------------------------------------------------------------|
| `challenges`       | Master list of structured, day-based challenges                         |
| `user_challenges`  | A user’s enrollment + progress in challenges                            |
| `challenge_logs`   | Per-day challenge logs (reflection, completion, AI notes)               |
| `quests`           | Multi-day, AI-randomized “mystery kindness” quests                      |
| `user_quests`      | A user’s enrollment + progress in quests                                |
| `quest_logs`       | Per-day quest logs with KAI-generated tasks                             |
| `badges`           | Badge catalog                                                            |
| `user_badges`      | Which badge a user has earned and when                                  |
| `kai_interactions` | Raw assistant interactions, function calls, useful for debugging/metrics|

> **Note:** `userdata` already exists and is the canonical users table.

---

## 2) ERD (text form)

- **userdata (id)** → **user_challenges.user_id**, **challenge_logs.user_id**, **user_quests.user_id**, **quest_logs.user_id**, **user_badges.user_id**, **kai_interactions.user_id**
- **challenges (id)** → **user_challenges.challenge_id**, **challenge_logs.challenge_id**
- **quests (id)** → **user_quests.quest_id**, **quest_logs.quest_id**
- **badges (id)** → **user_badges.badge_id**

---

## 3) Full DDL (Tables + Indexes + Suggested Unique Constraints)

### 3.1 `challenges`
```sql
CREATE TABLE challenges (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(150) NOT NULL,
    description       TEXT,
    total_days        INT NOT NULL,
    is_active         BOOLEAN DEFAULT TRUE,
    ai_prompt_template TEXT,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_challenges_active ON challenges(is_active);
```

### 3.2 `user_challenges`
```sql
CREATE TABLE user_challenges (
    id            SERIAL PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
    challenge_id  INT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    status        VARCHAR(50) NOT NULL,
    current_day   INT DEFAULT 0,
    start_date    DATE,
    completed_at  DATE,
    UNIQUE (user_id, challenge_id)
);

CREATE INDEX idx_user_challenges_user_id      ON user_challenges(user_id);
CREATE INDEX idx_user_challenges_challenge_id ON user_challenges(challenge_id);
CREATE INDEX idx_user_challenges_status       ON user_challenges(status);
```

### 3.3 `challenge_logs`
```sql
CREATE TABLE challenge_logs (
    id            SERIAL PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES userdata(id)   ON DELETE CASCADE,
    challenge_id  INT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    day_number    INT NOT NULL,
    reflection    TEXT,
    completed     BOOLEAN DEFAULT FALSE,
    completed_at  TIMESTAMP,
    kai_notes     TEXT,
    UNIQUE (user_id, challenge_id, day_number)
);

CREATE INDEX idx_challenge_logs_user_challenge ON challenge_logs(user_id, challenge_id);
CREATE INDEX idx_challenge_logs_day            ON challenge_logs(challenge_id, day_number);
```

### 3.4 `quests`
```sql
CREATE TABLE quests (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(150) NOT NULL,
    description       TEXT,
    total_days        INT NOT NULL,
    is_active         BOOLEAN DEFAULT TRUE,
    random_task_seed  TEXT,
    difficulty        VARCHAR(20) DEFAULT 'Medium',
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_quests_active ON quests(is_active);
```

### 3.5 `user_quests`
```sql
CREATE TABLE user_quests (
    id            SERIAL PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
    quest_id      INT NOT NULL REFERENCES quests(id)   ON DELETE CASCADE,
    status        VARCHAR(50) NOT NULL,
    current_day   INT DEFAULT 0,
    start_date    DATE,
    completed_at  DATE,
    UNIQUE (user_id, quest_id)
);

CREATE INDEX idx_user_quests_user_id  ON user_quests(user_id);
CREATE INDEX idx_user_quests_quest_id ON user_quests(quest_id);
CREATE INDEX idx_user_quests_status   ON user_quests(status);
```

### 3.6 `quest_logs`
```sql
CREATE TABLE quest_logs (
    id             SERIAL PRIMARY KEY,
    user_id        INT NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
    quest_id       INT NOT NULL REFERENCES quests(id)   ON DELETE CASCADE,
    day_number     INT NOT NULL,
    task_generated TEXT,
    reflection     TEXT,
    completed      BOOLEAN DEFAULT FALSE,
    completed_at   TIMESTAMP,
    UNIQUE (user_id, quest_id, day_number)
);

CREATE INDEX idx_quest_logs_user_quest ON quest_logs(user_id, quest_id);
CREATE INDEX idx_quest_logs_day        ON quest_logs(quest_id, day_number);
```

### 3.7 `badges`
```sql
CREATE TABLE badges (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    icon            VARCHAR(255),
    description     TEXT,
    points_required INT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.8 `user_badges`
```sql
CREATE TABLE user_badges (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
    badge_id   INT NOT NULL REFERENCES badges(id)   ON DELETE CASCADE,
    earned_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, badge_id)
);

CREATE INDEX idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX idx_user_badges_badge_id ON user_badges(badge_id);
```

### 3.9 `kai_interactions`
```sql
CREATE TABLE kai_interactions (
    id                 SERIAL PRIMARY KEY,
    user_id            INT NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
    context_type       VARCHAR(50),
    context_id         INT,
    message            TEXT,
    assistant_response TEXT,
    function_called    VARCHAR(100),
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kai_interactions_user_id ON kai_interactions(user_id);
CREATE INDEX idx_kai_interactions_context ON kai_interactions(context_type, context_id);
```

---

## 4) Handy Debug Queries

**List all tables:**
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY 1;
```

**Check foreign keys:**
```sql
SELECT
    tc.table_name,
    kcu.column_name,
    c.constraint_type
FROM information_schema.table_constraints AS c
JOIN information_schema.key_column_usage AS kcu
  ON c.constraint_name = kcu.constraint_name
WHERE c.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public';
```

---

## 5) Migration / Change Log (Template)

```text
### 2025-07-25
- Added UNIQUE(user_id, quest_id, day_number) to quest_logs
- Added difficulty to quests with default 'Medium'
- Documented schema
```

---

## 6) Maintenance Checklist

- After adding a new FK, **add an index** on it.
- Run `EXPLAIN ANALYZE` on dashboard queries when slow.
- Consider archiving old `kai_interactions` data if it grows too large.
- Keep Dev/Stage/Prod schemas in sync with this document.
