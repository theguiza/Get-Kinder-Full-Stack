# BR-02 Board Reporting Candidate Foundation Patch Notes

BR-02 adds immutable Board Reporting candidate persistence for the existing BR-01 server-computed packet/render/fingerprint chain.

- Adds `kai.board_reporting_candidates` with internal audience, server fingerprint, creator metadata, status, timestamps, and scoped idempotency.
- Adds `kai.board_reporting_candidate_members` as an ordered immutable snapshot of exact generated-content draft ids.
- Adds verifier, smoke seed/verifier, failure checks, rollback draft, and local PostgreSQL runner.
- Does not create Board review, release authority, final eligibility, manifest, delivery, or `board_update` generation.
