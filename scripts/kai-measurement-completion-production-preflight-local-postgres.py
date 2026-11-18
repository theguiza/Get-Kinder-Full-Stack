"""Exact measurement preflight proof on a newly created disposable loopback PG16 cluster.
No ambient DB targets, application imports, Node, client data or credentials.
Default verifies committed pins. --write-pins regenerates from actual migrations.
"""
import csv
import io
import json
import sys
import hashlib
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path('/opt/homebrew/opt/postgresql@16/bin')
PREFLIGHT = ROOT / 'scripts/kai-measurement-completion-production-preflight-read-only.sql'
DOCUMENT = 'kai_sprint2_document_statement_evidence'
REACH = 'kai_sprint2_measurement_mvp_cross_source_reach'
JOBS = 'kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs'
DERIVED = 'kai_sprint2_measurement_mvp_source_derived_measurements'
DERIVED_VERIFY = 'scripts/kai-measurement-mvp-derived-measurements-verify-read-only.sql'
XLSX_VERIFY = 'scripts/kai-sprint2-p2-01m-xlsx-worksheet-method-verify-read-only.sql'
JOBS_VERIFY = 'scripts/kai-measurement-mvp-cross-source-reconciliation-jobs-verify-read-only.sql'

# Whitelist, rather than inherit any ambient PostgreSQL service/connection URL.
ENV = {key: os.environ[key] for key in ('PATH', 'USER', 'HOME', 'TMPDIR', 'LANG') if key in os.environ}
ENV['DATABASE_URL'] = 'postgresql://kai_sentinel:kai_sentinel@127.0.0.1:1/kai_sentinel?connect_timeout=1'
ENV['PGDATABASE'] = 'kai_measurement_preflight_synthetic'
ENV['PGUSER'] = os.environ.get('USER', 'postgres')
ENV['PGHOST'] = '127.0.0.1'
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    ENV['PGPORT'] = str(probe.getsockname()[1])


def run(command, args, sql=None, expected_error=None):
    result = subprocess.run([str(BIN / command), *args], input=sql, text=True,
                            capture_output=True, cwd=ROOT, env=ENV)
    if expected_error:
        assert result.returncode != 0 and expected_error in result.stderr, result.stderr
    elif result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout


def execute(sql):
    return run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1'], sql)


def rows(sql):
    output = run('psql', ['-Xq', '--csv', '-v', 'ON_ERROR_STOP=1'], sql)
    return list(csv.DictReader(io.StringIO(output)))


def file_rows(path):
    # Production files are executed verbatim inside enforced read-only mode.
    return rows('BEGIN READ ONLY; SET LOCAL search_path = pg_catalog, kai, public;\n'
                + (ROOT / path).read_text() + '\nCOMMIT;')


def verifier(path, expected='PASS'):
    result = file_rows(path)
    overall = next(row for row in result if row['check_id'] == 'OVERALL')
    assert overall['status'] == expected, (path, result)
    print(f'{path}: OVERALL {expected}', flush=True)
    return result


def migrate(name):
    execute((ROOT / f'migrations/{name}.sql').read_text())
    print(f'COMMITTED {name}', flush=True)


CALC = 'kai_sprint2_measurement_calculation_completion'
TARGETS = 'kai_sprint2_measurement_targets'
EVIDENCE = ROOT / 'artifacts/kai-measurement-completion-catalog-evidence.json'
if sys.argv[1:] not in ([], ['--write-pins']):
    raise SystemExit('Usage: python3 scripts/kai-measurement-completion-production-preflight-local-postgres.py [--write-pins]')


def catalog_sql(tail):
    prefix = PREFLIGHT.read_text().split('), pins(', 1)[0]
    return prefix + ') ' + tail + ';\nROLLBACK;'


def facts():
    return {r['check_id']: r['signature'] for r in rows(catalog_sql('SELECT * FROM facts'))}


def definitions():
    return rows(catalog_sql("SELECT name, kind, identity, definition FROM objects ORDER BY name, kind, identity COLLATE \"C\"")) + rows(catalog_sql("SELECT 'function' AS name, 'function' AS kind, p.oid::regprocedure::text AS identity, pg_get_functiondef(p.oid) AS definition FROM pg_proc p WHERE p.oid IN (to_regprocedure('kai.source_derived_measurement_source_admitted()'), to_regprocedure('kai.source_derived_measurement_append_only()'), to_regprocedure('kai.gate_a_p0_jsonb_metadata_only(jsonb)')) ORDER BY identity"))


def preflight(label, calc, targets, overall):
    result = rows(PREFLIGHT.read_text() + '\nROLLBACK;')
    assert len(result) == 30, (label, 'expected 30 result rows', len(result))
    states = {r['check_id']: r['status'] for r in result if r['row_kind'] in ('MIGRATION', 'OVERALL')}
    assert states == {'calculation': calc, 'targets': targets, 'OVERALL': overall}, (label, states, result)
    print(f'{label}: {states}', flush=True)
    return result


def pins(pre, post):
    def capability(key):
        if key == 'function.source_derived_measurement_append_only()':
            return 'shared'
        return 'targets' if key.startswith(('measurement_targets.', 'namespace.targets', 'type.measurement_targets')) else 'calculation'
    return ',\n'.join(f"    ('{key}', '{pre[key]}', '{post[key]}', '{capability(key)}')" for key in sorted(pre))


def check_rate_semantics():
    # Evaluate only the committed CHECK from the empty synthetic database,
    # against literals. Preserve SQL NULL as distinct from TRUE/FALSE.
    definition = rows("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'kai.source_derived_measurements'::regclass AND conname = 'source_derived_measurements_rate_counts_check'")[0]['def'][6:]
    cases = [
        ('record good', 'kai_tabular_conditional_record_rate_v1', {'population_record_count': 5, 'numerator_record_count': 3, 'other_population_record_count': 2}, {}, 'true'),
        ('record bad', 'kai_tabular_conditional_record_rate_v1', {'population_record_count': 5, 'numerator_record_count': 3, 'other_population_record_count': 1}, {}, 'false'),
        ('NULL method bad record arithmetic', None, {'population_record_count': 5, 'numerator_record_count': 3, 'other_population_record_count': 1}, {}, 'false'),
        ('distinct identifiers good, records differ', 'kai_tabular_conditional_distinct_key_rate_v1', {'population_distinct_key_count': 5, 'numerator_distinct_key_count': 3, 'other_population_distinct_key_count': 2, 'population_record_count': 8, 'numerator_record_count': 4}, {'unit': {'kind': 'distinct_key'}}, 'true'),
        ('distinct identifiers bad', 'kai_tabular_conditional_distinct_key_rate_v1', {'population_distinct_key_count': 5, 'numerator_distinct_key_count': 3, 'other_population_distinct_key_count': 1, 'population_record_count': 8, 'numerator_record_count': 4}, {'unit': {'kind': 'distinct_key'}}, 'false'),
        ('distinct identifiers above records', 'kai_tabular_conditional_distinct_key_rate_v1', {'population_distinct_key_count': 5, 'numerator_distinct_key_count': 3, 'other_population_distinct_key_count': 2, 'population_record_count': 4, 'numerator_record_count': 4}, {'unit': {'kind': 'distinct_key'}}, 'false'),
        ('distinct wrong unit', 'kai_tabular_conditional_distinct_key_rate_v1', {'population_distinct_key_count': 5, 'numerator_distinct_key_count': 3, 'other_population_distinct_key_count': 2, 'population_record_count': 8, 'numerator_record_count': 4}, {'unit': {'kind': 'record'}}, 'false'),
        ('missing JSON operands retain SQL NULL', 'kai_tabular_conditional_distinct_key_rate_v1', {}, {'unit': {'kind': 'distinct_key'}}, 'NULL'),
    ]
    for label, method, counts, definition_json, expected in cases:
        def literal(value):
            return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
        query = f"SELECT coalesce(({definition})::text, 'NULL') AS observed FROM (VALUES ('tabular_rate'::text, {literal(method)}::text, {literal(json.dumps(counts))}::jsonb, {literal(json.dumps(definition_json))}::jsonb, 3::bigint, 5::bigint)) t(measurement_family, calculation_method, component_counts, definition, numerator, denominator)"
        actual = rows('BEGIN READ ONLY; ' + query + '; ROLLBACK;')[0]['observed']
        assert actual == expected, (label, actual, expected)
        print(f'Rate CHECK literal: {label}: {actual}', flush=True)


started = False
work = Path(tempfile.mkdtemp(prefix='kai-mp-', dir='/tmp'))
try:
    assert run('postgres', ['--version']).startswith('postgres (PostgreSQL) 16.'), 'PostgreSQL 16 required'
    (work / 'socket').mkdir()
    run('initdb', ['-D', str(work / 'data'), '--no-locale', '--encoding=UTF8', '--auth=trust'])
    run('pg_ctl', ['-D', str(work / 'data'), '-l', str(work / 'postgres.log'), '-o',
                   f'-k {work / "socket"} -h 127.0.0.1 -p {ENV["PGPORT"]}', 'start'])
    started = True
    run('createdb', [ENV['PGDATABASE']])
    identity = rows("SELECT current_database() AS db, inet_server_addr()::text AS host, "
                    "inet_server_port()::text AS port, current_setting('listen_addresses') AS listen")[0]
    assert identity['host'] in ('127.0.0.1', '127.0.0.1/32'), identity
    assert identity['db'] == ENV['PGDATABASE'] and identity['port'] == ENV['PGPORT'] and identity['listen'] == '127.0.0.1', identity
    execute('CREATE EXTENSION pgcrypto;')
    execute((ROOT / 'scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql').read_text())
    execute('ALTER TABLE kai.engagements ADD CONSTRAINT kai_plan_a_assembled_engagements_id_org_unique UNIQUE (engagement_id, organization_id);')
    execute((ROOT / 'scripts/kai-sprint2-package-4-impact-library-engagement-funder-requirements-auth-bootstrap-synthetic-schema.sql').read_text())
    execute("INSERT INTO kai.roles (role_name) VALUES ('client_admin'), ('client_contributor') ON CONFLICT DO NOTHING;")
    execute('ALTER TABLE public.userdata ADD COLUMN email_verified boolean DEFAULT true, ADD COLUMN is_suspended boolean DEFAULT false;')
    execute('ALTER TABLE public.organizations ADD COLUMN status text, ADD COLUMN logo_url text;')
    execute("CREATE TABLE public.org_applications (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES public.userdata(id), org_name text NOT NULL, org_description text, org_website text, rep_role text, status text NOT NULL DEFAULT 'pending', submitted_at timestamptz DEFAULT now(), reviewed_at timestamptz, reviewed_by text);")
    execute((ROOT / 'scripts/kai-sprint2-intake-duplicate-resolution-production-shape-synthetic-schema.sql').read_text())
    chain_text = (ROOT / 'scripts/kai-sprint2-plan-a-migration-chain.js').read_text()
    chain = re.findall(r'"(kai_sprint2_[^"]+)"', chain_text.split('export const MIGRATION_CHAIN = [')[1].split('];')[0])
    expected_refusals = {
        'kai_sprint2_legacy_generation_cutover_20260817': 'only accepts a fully-legacy pre-cutover state or its own fully-converged post-cutover state',
        'kai_sprint2_p1_06_review_status_column_repair': 'converged-state check failed: expected exactly 1 CHECK constraint governing review_status',
    }
    assert chain[-6:] == [DERIVED, REACH, JOBS, DOCUMENT, CALC, TARGETS], chain[-6:]
    for name in chain:
        if name in (CALC, TARGETS):
            continue
        if name in expected_refusals:
            run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1', '-f', str(ROOT / f'migrations/{name}.sql')],
                expected_error=expected_refusals[name])
        else:
            migrate(name)
    pre, pre_defs = facts(), definitions()
    migrate(CALC)
    middle = facts()
    migrate(TARGETS)
    post, post_defs = facts(), definitions()
    captured = {
        'source_revision': 'ed37dddd167a5ce4543ca6ed841be090060b1242',
        'postgres_version': run('postgres', ['--version']).strip(),
        'rollback_sha256': {n: hashlib.sha256((ROOT / f'migrations/{n}.rollback.sql').read_bytes()).hexdigest() for n in (CALC, TARGETS)},
        'migrations_sha256': {n: hashlib.sha256((ROOT / f'migrations/{n}.sql').read_bytes()).hexdigest() for n in chain},
        'prerequisite': {'signatures': pre, 'objects': pre_defs},
        'completed': {'signatures': post, 'objects': post_defs},
    }
    if '--write-pins' in sys.argv:
        text = PREFLIGHT.read_text()
        text = text.split('-- BEGIN GENERATED PINS')[0] + '-- BEGIN GENERATED PINS\n' + pins(pre, post) + '\n-- END GENERATED PINS' + text.split('-- END GENERATED PINS')[1]
        PREFLIGHT.write_text(text)
        EVIDENCE.write_text(json.dumps(captured, indent=2) + '\n')
    else:
        expected = json.loads(EVIDENCE.read_text())
        for key in ('source_revision', 'migrations_sha256', 'rollback_sha256', 'prerequisite', 'completed'):
            assert captured[key] == expected[key], f'catalog evidence drift: {key}'
        text = PREFLIGHT.read_text()
        assert text.split('-- BEGIN GENERATED PINS\n')[1].split('\n-- END GENERATED PINS')[0] == pins(pre, post)
    unsupported = rows(PREFLIGHT.read_text().replace("current_setting('server_version_num')::integer / 10000 AS server_major", '17 AS server_major') + '\nROLLBACK;')
    assert all(row['status'] == 'STOP_INCOMPATIBLE' for row in unsupported if row['row_kind'] in ('ENVIRONMENT', 'MIGRATION', 'OVERALL'))
    print('Unsupported major guard (simulated 17 on PG16): STOP_INCOMPATIBLE', flush=True)
    check_rate_semantics()
    preflight('C both applied', 'ALREADY_APPLIED', 'ALREADY_APPLIED', 'SCHEMA_COMPATIBLE')
    for path in (DERIVED_VERIFY, JOBS_VERIFY, XLSX_VERIFY, 'scripts/kai-reporting-schema-verify-read-only.sql'):
        verifier(path)
    # Restore known pristine synthetic states using refusing rollbacks on EMPTY tables only.
    execute((ROOT / f'migrations/{TARGETS}.rollback.sql').read_text())
    preflight('B calculation only', 'ALREADY_APPLIED', 'REQUIRED', 'SCHEMA_DELTA_REQUIRED')
    assert facts() == middle
    execute((ROOT / f'migrations/{CALC}.rollback.sql').read_text())
    preflight('A prerequisite', 'REQUIRED', 'REQUIRED', 'SCHEMA_DELTA_REQUIRED')
    assert facts() == pre
    migrate(TARGETS)
    preflight('independent targets already applied', 'REQUIRED', 'ALREADY_APPLIED', 'SCHEMA_DELTA_REQUIRED')
    execute((ROOT / f'migrations/{TARGETS}.rollback.sql').read_text())
    # A partial state must stop, even when IF NOT EXISTS could hide it.
    execute('ALTER TABLE kai.source_derived_measurement_sources ADD COLUMN worksheet_key text;')
    preflight('D1 partial calculation column', 'STOP_INCOMPATIBLE', 'REQUIRED', 'STOP_INCOMPATIBLE')
    execute('ALTER TABLE kai.source_derived_measurement_sources DROP COLUMN worksheet_key;')
    # Reserved index name on the wrong relation must also stop.
    execute('CREATE INDEX source_derived_measurement_sources_version_worksheet_unique ON kai.source_versions (source_version_id);')
    preflight('D2 reserved calculation index collision', 'STOP_INCOMPATIBLE', 'REQUIRED', 'STOP_INCOMPATIBLE')
    execute('DROP INDEX kai.source_derived_measurement_sources_version_worksheet_unique;')
    execute('CREATE TABLE kai.measurement_targets (measurement_target_id uuid);')
    preflight('D3 same-named incomplete target table', 'REQUIRED', 'STOP_INCOMPATIBLE', 'STOP_INCOMPATIBLE')
    execute('DROP TABLE kai.measurement_targets;')
    execute('CREATE INDEX ix_measurement_targets_identity ON kai.source_versions (source_version_id);')
    preflight('D4 reserved target index collision', 'REQUIRED', 'STOP_INCOMPATIBLE', 'STOP_INCOMPATIBLE')
    execute('DROP INDEX kai.ix_measurement_targets_identity;')
    execute('CREATE TYPE kai.measurement_targets AS (unexpected text);')
    preflight('D5 composite type collision', 'REQUIRED', 'STOP_INCOMPATIBLE', 'STOP_INCOMPATIBLE')
    execute('DROP TYPE kai.measurement_targets;')
    migrate(CALC)
    migrate(TARGETS)
    fk_trigger = rows("SELECT tr.tgname FROM pg_trigger tr JOIN pg_constraint c ON c.oid = tr.tgconstraint WHERE c.conrelid = 'kai.measurement_targets'::regclass AND c.conname = 'measurement_targets_measurement_fk' AND tr.tgrelid = c.conrelid ORDER BY tr.tgname LIMIT 1")[0]['tgname']
    negatives = [
      ('target FK enforcement disabled', 'ALTER TABLE kai.measurement_targets DISABLE TRIGGER \"' + fk_trigger + '\"', 'targets'),
      ('calculation CHECK', 'ALTER TABLE kai.source_derived_measurements DROP CONSTRAINT source_derived_measurements_rate_counts_check', 'calculation'),
      ('calculation index', 'DROP INDEX kai.source_derived_measurement_sources_version_worksheet_unique', 'calculation'),
      ('job default', "ALTER TABLE kai.cross_source_reconciliation_jobs ALTER COLUMN job_kind SET DEFAULT 'tabular_exact_period'", 'calculation'),
      ('job nullability', 'ALTER TABLE kai.cross_source_reconciliation_jobs ALTER COLUMN reference_source_version_id SET NOT NULL', 'calculation'),
      ('admission trigger disabled', 'ALTER TABLE kai.source_derived_measurement_sources DISABLE TRIGGER trg_source_derived_measurement_sources_admitted', 'calculation'),
      ('admission function', "CREATE OR REPLACE FUNCTION kai.source_derived_measurement_source_admitted() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END;$$", 'calculation'),
      ('target CHECK', 'ALTER TABLE kai.measurement_targets DROP CONSTRAINT measurement_targets_unit_value_check', 'targets'),
      ('target FK', 'ALTER TABLE kai.measurement_targets DROP CONSTRAINT measurement_targets_measurement_fk', 'targets'),
      ('target self FK', 'ALTER TABLE kai.measurement_targets DROP CONSTRAINT measurement_targets_supersedes_fk', 'targets'),
      ('target index', 'DROP INDEX kai.measurement_targets_single_successor_unique', 'targets'),
      ('target column nullability', 'ALTER TABLE kai.measurement_targets ALTER COLUMN target_value DROP NOT NULL', 'targets'),
      ('target trigger', 'DROP TRIGGER trg_measurement_targets_append_only ON kai.measurement_targets', 'targets'),
      ('append-only function', "CREATE OR REPLACE FUNCTION kai.source_derived_measurement_append_only() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END;$$", 'both'),
    ]
    for label, mutation, affected in negatives:
        # Mutate only the runner-owned cluster, then restore the captured
        # committed definition and assert every catalog signature matches.
        result = rows('BEGIN; ' + mutation + '; COMMIT;\n' + PREFLIGHT.read_text() + '\nROLLBACK;')
        states = {r['capability']: r['status'] for r in result if r['row_kind'] == 'MIGRATION'}
        assert states['calculation'] == ('STOP_INCOMPATIBLE' if affected in ('calculation', 'both') else 'ALREADY_APPLIED'), (label, states)
        assert states['targets'] == ('STOP_INCOMPATIBLE' if affected in ('targets', 'both') or label == 'calculation CHECK' else 'ALREADY_APPLIED'), (label, states)
        print(f'Negative {label}: {states}', flush=True)
        # Restore the exact empty synthetic schema; never change the pins
        # to make a negative test pass.
        if affected == 'calculation':
            if label == 'calculation CHECK':
                obj = next(o for o in post_defs if o['kind'] == 'constraint' and o['identity'] == 'source_derived_measurements_rate_counts_check')
                execute('ALTER TABLE kai.source_derived_measurements ADD CONSTRAINT source_derived_measurements_rate_counts_check ' + json.loads(obj['definition'])[2])
            elif label == 'calculation index':
                obj = next(o for o in post_defs if o['kind'] == 'index' and o['identity'] == 'source_derived_measurement_sources_version_worksheet_unique')
                execute(json.loads(obj['definition'])[1])
            elif label == 'job default':
                execute("ALTER TABLE kai.cross_source_reconciliation_jobs ALTER COLUMN job_kind SET DEFAULT 'cross_source_reach'")
            elif label == 'job nullability':
                execute('ALTER TABLE kai.cross_source_reconciliation_jobs ALTER COLUMN reference_source_version_id DROP NOT NULL')
            elif label == 'admission trigger disabled':
                execute('ALTER TABLE kai.source_derived_measurement_sources ENABLE TRIGGER trg_source_derived_measurement_sources_admitted')
            else:
                execute(next(o['definition'] for o in post_defs if o['kind'] == 'function' and 'source_derived_measurement_source_admitted' in o['identity']))
        elif affected == 'both':
            execute(next(o['definition'] for o in post_defs if o['kind'] == 'function' and 'source_derived_measurement_append_only' in o['identity']))
        else:
            execute('DROP TABLE kai.measurement_targets;')
            migrate(TARGETS)
        assert facts() == post, label
    preflight('restored completed', 'ALREADY_APPLIED', 'ALREADY_APPLIED', 'SCHEMA_COMPATIBLE')
    print('PASS: A/B/C, 19 incompatible states; exact pins reproduced from committed migrations; four existing verifiers PASS.', flush=True)
finally:
    if started:
        run('pg_ctl', ['-D', str(work / 'data'), 'stop', '-m', 'fast'])
    shutil.rmtree(work)
    print('Removed runner-owned disposable cluster.', flush=True)
