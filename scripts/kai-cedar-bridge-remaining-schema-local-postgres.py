"""Prove the owner's derived -> document -> reach -> jobs order locally.

No ambient DB connection settings, application imports, fixtures, or secrets.
Creates and stops its own temporary PostgreSQL 16 cluster. Never accepts a URL.
Run: python3 scripts/kai-cedar-bridge-remaining-schema-local-postgres.py
"""
import csv
import io
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path('/opt/homebrew/opt/postgresql@16/bin')
PREFLIGHT = ROOT / 'scripts/kai-cedar-bridge-remaining-schema-preflight-read-only.sql'
DOCUMENT = 'kai_sprint2_document_statement_evidence'
REACH = 'kai_sprint2_measurement_mvp_cross_source_reach'
JOBS = 'kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs'
DERIVED = 'kai_sprint2_measurement_mvp_source_derived_measurements'
PACKET = 'KAI_PGADMIN_DOCUMENT_STATEMENT_EVIDENCE_PACKET/'
DERIVED_VERIFY = 'scripts/kai-measurement-mvp-derived-measurements-verify-read-only.sql'
XLSX_VERIFY = 'scripts/kai-sprint2-p2-01m-xlsx-worksheet-method-verify-read-only.sql'
JOBS_VERIFY = 'scripts/kai-measurement-mvp-cross-source-reconciliation-jobs-verify-read-only.sql'

# Whitelist, rather than inherit any ambient PostgreSQL service/connection URL.
ENV = {key: os.environ[key] for key in ('PATH', 'USER', 'HOME', 'TMPDIR', 'LANG') if key in os.environ}
ENV['DATABASE_URL'] = 'postgresql://kai_sentinel:kai_sentinel@127.0.0.1:1/kai_sentinel?connect_timeout=1'
ENV['PGDATABASE'] = 'kai_cedar_remaining_schema_synthetic'
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


def facts():
    sql = PREFLIGHT.read_text()
    prefix = sql.split('WITH targets', 1)[1].split('), pins(', 1)[0]
    return {row['name']: row['signature'] for row in rows(
        'BEGIN READ ONLY; SET LOCAL search_path = pg_catalog, kai, public;\nWITH targets'
        + prefix + ') SELECT * FROM facts;\nCOMMIT;')}


def preflight(reach, jobs):
    result = rows(PREFLIGHT.read_text())
    observed = {row['capability']: row['status'] for row in result}
    assert observed['reach'] == reach and observed['jobs'] == jobs, result
    if reach != 'STOP_INCOMPATIBLE':
        assert observed['document'] == observed['prerequisite'] == 'ALREADY_APPLIED', result
    print(f'Preflight: reach={reach}, jobs={jobs}', flush=True)


started = False
work = Path(tempfile.mkdtemp(prefix='kai-cb-pg-'))
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
    assert chain[-4:] == [DERIVED, REACH, JOBS, DOCUMENT], chain[-4:]
    for name in chain:
        if name in (DOCUMENT, REACH, JOBS):
            continue
        if name in expected_refusals:
            run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1', '-f', str(ROOT / f'migrations/{name}.sql')],
                expected_error=expected_refusals[name])
        else:
            migrate(name)
    before = facts()
    migrate(DOCUMENT)
    document_facts = facts()
    # The document migration is now committed, BEFORE reach or jobs exists.
    assert document_facts['source_derived_measurement_sources'] == document_facts['cross_source_reconciliation_jobs'] == 'ABSENT'
    for key in ('source_derived_measurements_method_family_check', 'source_derived_measurements_arithmetic_check'):
        assert before[key] == document_facts[key]
    pre_result = verifier(DERIVED_VERIFY)
    assert next(r for r in pre_result if r['check_id'] == 'D0.schema_state')['observed'] == 'before the cross-source reach migration'
    assert next(r for r in pre_result if r['check_id'] == 'D7.contributing_sources')['observed'] == 'not applied'
    verifier(XLSX_VERIFY)
    # The document packet's whole preflight must currently stop ONLY for P02/P03.
    packet = verifier(PACKET + '00_DOCUMENT_EVIDENCE_PREFLIGHT_READ_ONLY.sql', 'STOP_INCOMPATIBLE')
    assert {r['check_id'] for r in packet if r['status'] == 'FAIL'} == {'P02', 'P03'}, packet
    assert all(r['status'] == 'POST' for r in packet if r['check_id'].startswith('D0')), packet
    preflight('REQUIRED', 'REQUIRED')
    migrate(REACH)
    after_reach = facts()
    for key in document_facts:
        if key.startswith('evidence_items_') or key.startswith('source_locators_'):
            assert document_facts[key] == after_reach[key], key
    post_result = verifier(DERIVED_VERIFY)
    assert next(r for r in post_result if r['check_id'] == 'D0.schema_state')['observed'] == 'after the cross-source reach migration'
    d7 = next(r for r in post_result if r['check_id'] == 'D7.contributing_sources')
    assert d7['status'] == 'PASS' and 'admission trigger=1' in d7['observed'], d7
    verifier(XLSX_VERIFY)
    preflight('ALREADY_APPLIED', 'REQUIRED')
    migrate(JOBS)
    final = facts()
    assert all(final[key] == value for key, value in after_reach.items() if key != 'cross_source_reconciliation_jobs')
    verifier(DERIVED_VERIFY)
    verifier(JOBS_VERIFY)
    verifier(XLSX_VERIFY)
    verifier(PACKET + '01V_VERIFY_AFTER_document_statement_evidence_READ_ONLY.sql')
    verifier(PACKET + '00_DOCUMENT_EVIDENCE_PREFLIGHT_READ_ONLY.sql', 'ALREADY_APPLIED')
    preflight('ALREADY_APPLIED', 'ALREADY_APPLIED')
    # Partial installation: IF NOT EXISTS must never hide a missing index.
    execute('DROP INDEX kai.ix_cross_source_reconciliation_jobs_due;')
    preflight('STOP_INCOMPATIBLE', 'STOP_INCOMPATIBLE')
    migrate(JOBS)  # Restores only this local synthetic index.
    preflight('ALREADY_APPLIED', 'ALREADY_APPLIED')
    arithmetic = rows("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'kai.source_derived_measurements'::regclass AND conname = 'source_derived_measurements_arithmetic_check'")[0]['definition']
    execute('ALTER TABLE kai.source_derived_measurements DROP CONSTRAINT source_derived_measurements_arithmetic_check;')
    preflight('STOP_INCOMPATIBLE', 'STOP_INCOMPATIBLE')
    execute('ALTER TABLE kai.source_derived_measurements ADD CONSTRAINT source_derived_measurements_arithmetic_check ' + arithmetic)
    preflight('ALREADY_APPLIED', 'ALREADY_APPLIED')
    # Same partial-state protection for the already-applied document schema.
    coordinates = rows("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'kai.source_locators'::regclass AND conname = 'source_locators_p2_01_coordinates_check'")[0]['definition']
    execute('ALTER TABLE kai.source_locators DROP CONSTRAINT source_locators_p2_01_coordinates_check;')
    preflight('STOP_INCOMPATIBLE', 'STOP_INCOMPATIBLE')
    execute('ALTER TABLE kai.source_locators ADD CONSTRAINT source_locators_p2_01_coordinates_check ' + coordinates)
    preflight('ALREADY_APPLIED', 'ALREADY_APPLIED')
    assert facts() == final, 'negative tests failed to restore the runner-owned schema'
    print('PASS: actual committed derived -> document -> reach -> jobs order; existing verifiers; document CHECKs unchanged.', flush=True)
finally:
    if started:
        run('pg_ctl', ['-D', str(work / 'data'), 'stop', '-m', 'fast'])
    shutil.rmtree(work)
    print('Removed runner-owned disposable cluster.', flush=True)
