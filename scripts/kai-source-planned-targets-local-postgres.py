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
ENV['PGDATABASE'] = 'kai_source_planned_targets_synthetic'
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


PLAN = 'kai_sprint2_source_planned_targets'
started = False
work = Path(tempfile.mkdtemp(prefix='kai-plans-', dir='/tmp'))
try:
    (work / 'socket').mkdir()
    run('initdb', ['-D', str(work/'data'), '--no-locale', '--encoding=UTF8', '--auth=trust'])
    run('pg_ctl', ['-D', str(work/'data'), '-l', str(work/'pg.log'), '-o', f'-k {work / "socket"} -h 127.0.0.1 -p {ENV["PGPORT"]}', 'start'])
    started = True
    run('createdb', [ENV['PGDATABASE']])
    identity = rows("SELECT current_database() AS db,inet_server_addr()::text AS host,current_setting('listen_addresses') AS listen")[0]
    assert identity['db'] == ENV['PGDATABASE'] and identity['host'] in ('127.0.0.1','127.0.0.1/32') and identity['listen'] == '127.0.0.1', identity
    execute('CREATE EXTENSION pgcrypto;')
    execute((ROOT/'scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql').read_text())
    execute('ALTER TABLE kai.engagements ADD CONSTRAINT kai_plan_a_assembled_engagements_id_org_unique UNIQUE (engagement_id, organization_id);')
    execute((ROOT/'scripts/kai-sprint2-package-4-impact-library-engagement-funder-requirements-auth-bootstrap-synthetic-schema.sql').read_text())
    execute((ROOT/'scripts/kai-sprint2-intake-duplicate-resolution-production-shape-synthetic-schema.sql').read_text())
    chain_text = (ROOT/'scripts/kai-sprint2-plan-a-migration-chain.js').read_text()
    chain = re.findall(r'"(kai_sprint2_[^"]+)"', chain_text.split('export const MIGRATION_CHAIN = [')[1].split('];')[0])
    refusals = {
      'kai_sprint2_legacy_generation_cutover_20260817':'only accepts a fully-legacy pre-cutover state or its own fully-converged post-cutover state',
      'kai_sprint2_p1_06_review_status_column_repair':'converged-state check failed: expected exactly 1 CHECK constraint governing review_status',
    }
    for name in chain[:-1]:
        if name in refusals:
            run('psql',['-Xq','-v','ON_ERROR_STOP=1','-f',str(ROOT/f'migrations/{name}.sql')],expected_error=refusals[name])
        else: execute((ROOT/f'migrations/{name}.sql').read_text())
    assert chain[-1] == PLAN
    prior = rows("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('kai.measurement_targets'::regclass,'kai.evidence_items'::regclass,'kai.source_locators'::regclass) ORDER BY conrelid,conname")
    execute((ROOT/f'migrations/{PLAN}.sql').read_text())
    verifier('scripts/kai-source-planned-targets-verify-read-only.sql')
    execute((ROOT/f'migrations/{PLAN}.rollback.sql').read_text())
    after = rows("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('kai.measurement_targets'::regclass,'kai.evidence_items'::regclass,'kai.source_locators'::regclass) ORDER BY conrelid,conname")
    assert after == prior, 'rollback must restore previous constraints exactly'
    assert rows("SELECT to_regclass('kai.source_planned_targets') IS NULL AS gone")[0]['gone'] == 't'
    execute((ROOT/f'migrations/{PLAN}.sql').read_text())
    verifier('scripts/kai-source-planned-targets-verify-read-only.sql')
    verifier('scripts/kai-reporting-schema-verify-read-only.sql')
    print(json.dumps(rows("SELECT conname,md5(pg_get_constraintdef(oid)) AS fingerprint FROM pg_constraint WHERE conrelid IN ('kai.evidence_items'::regclass,'kai.source_locators'::regclass) AND conname IN ('evidence_items_p2_01_evidence_type_check','evidence_items_p2_01m_type_class_pairing_check','source_locators_p2_01_locator_type_check','source_locators_p2_01_coordinates_check') ORDER BY conname")), flush=True)
    print('PASS: fresh chain, upgrade, read-only verification, empty rollback, exact prior constraints, reapply; manual-target schema unchanged', flush=True)
finally:
    if started: run('pg_ctl',['-D',str(work/'data'),'stop','-m','fast'])
    shutil.rmtree(work)
    print('Disposable cluster removed', flush=True)
