DO $$
BEGIN
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, engagement_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '15030000-0000-4000-8000-000000000101',
      'board_reporting_candidate_review',
      'generated_content_draft',
      '15030000-0000-4000-8000-000000000301',
      'medium',
      'open',
      'needs_gk_review',
      'Board Reporting candidate requires review.',
      'Review internal Board packet membership and current-use support before release work.',
      '{}'::jsonb,
      'system'
    );
    RAISE EXCEPTION 'BR-03A failure check failed: wrong target_object_type was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, engagement_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '15030000-0000-4000-8000-000000000101',
      'board_reporting_candidate_review',
      'board_reporting_candidate',
      '15030000-0000-4000-8000-000000000301',
      'medium',
      'in_progress',
      'needs_gk_review',
      'Board Reporting candidate requires review.',
      'Review internal Board packet membership and current-use support before release work.',
      '{}'::jsonb,
      'system'
    );
    RAISE EXCEPTION 'BR-03A failure check failed: start state was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, engagement_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '15030000-0000-4000-8000-000000000101',
      'board_reporting_candidate_review',
      'board_reporting_candidate',
      '15030000-0000-4000-8000-000000000301',
      'medium',
      'open',
      'needs_gk_review',
      'Board Reporting candidate requires review.',
      'Review internal Board packet membership and current-use support before release work.',
      '{}'::jsonb,
      'system'
    );
    RAISE EXCEPTION 'BR-03A failure check failed: duplicate review identity was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;
