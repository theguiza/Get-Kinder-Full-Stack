"""Service-event measurement migration proof on a newly created disposable loopback PG16 cluster.

Fresh Plan A chain up to the migration, upgrade, CHECK admission of rows the
application's own pure derivation produces (Node, with a non-listening
DATABASE_URL sentinel), refusal of deliberately broken rows, populated rollback
refusal, unused rollback restoring every prior constraint definition exactly,
reapply and the read-only reporting verifier. No ambient DB target, client
data, credentials or existing database. Row inserts run with
session_replication_role = replica so FK/append-only triggers do not need a full
synthetic lineage; CHECK constraints are still enforced in that mode.
"""
import csv
import io
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIN = Path('/opt/homebrew/opt/postgresql@16/bin')
SERVICE = 'kai_sprint2_service_event_measurements'
SENTINEL = 'postgres://127.0.0.1:9/kai_sentinel'

ENV = {key: os.environ[key] for key in ('PATH', 'USER', 'HOME', 'TMPDIR', 'LANG') if key in os.environ}
ENV['DATABASE_URL'] = SENTINEL
ENV['PGDATABASE'] = 'kai_service_event_measurements_synthetic'
ENV['PGUSER'] = os.environ.get('USER', 'postgres')
ENV['PGHOST'] = '127.0.0.1'
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    ENV['PGPORT'] = str(probe.getsockname()[1])

# The application's own derivation over synthetic records (no file, no database).
NODE = r'''
const S = await import(process.cwd() + "/Backend/kai/validators/kaiServiceEventMeasurements.js");
const { reconcileServiceEvents, serviceHeadingTerms } = await import(process.cwd() + "/Backend/kai/parsing/serviceEventReconciliation.js");
const header = ["event_id", "household_id", "service_date", "program_code", "delivery_status"];
const data = [
  ["E1", "H1", "2025-04-02", "PA", "completed"], ["E2", "H1", "2025-05-02", "FS", "completed"], ["E2", "H1", "2025-05-02", "FS", "completed"],
  ["E3", "H2", "2025-06-02", "PA", "cancelled"], ["E4", "H2", "2026-04-02", "PA", "completed"], ["E5", "H3", "2025-07-02", "PA", "completed"],
  ["E5", "H3", "2025-07-09", "PA", "completed"],
];
const records = [header, ...data];
const basis = {
  basis_version: "kai_tabular_measurement_basis_v1", status: "assessed", record_count: data.length,
  fields: [
    { field_key: "field_1", roles: ["identifier"], present_count: 7, blank_count: 0, identifier: { distinct_count: 5, repeated_key_count: 2 } },
    { field_key: "field_2", roles: ["identifier"], present_count: 7, blank_count: 0, identifier: { distinct_count: 3, repeated_key_count: 3 } },
    { field_key: "field_3", roles: ["date"], present_count: 7, blank_count: 0 },
    { field_key: "field_4", roles: ["categorical"], present_count: 7, blank_count: 0, categorical: { values: [{ value_key: "value_1", label: "FS", record_count: 2 }, { value_key: "value_2", label: "PA", record_count: 5 }], withheld_record_count: 0 } },
    { field_key: "field_5", roles: ["categorical"], present_count: 7, blank_count: 0, categorical: { values: [{ value_key: "value_1", label: "cancelled", record_count: 1 }, { value_key: "value_2", label: "completed", record_count: 6 }], withheld_record_count: 0 } },
  ],
};
const headings = Object.fromEntries(header.map((text, index) => [`field_${index + 1}`, { terms: serviceHeadingTerms(text), personal: false }]));
const period = { start: "2025-04-01", end: "2026-03-31" };
const build = (selections) => {
  const discovered = S.discoverServiceEventRoles({ basis, headings, selections });
  const planned = S.planServiceEventFindings({ discovery: discovered.discovery, reportingPeriod: period, materialFieldKeys: S.serviceMaterialFieldKeys(basis) });
  const reconciliations = Object.fromEntries(Object.entries(planned.plans).map(([mode, plan]) => [mode, reconcileServiceEvents({ records, plan })]));
  return S.deriveServiceEventMeasurements({ planned, reconciliations, sheetKey: null, reportingPeriod: period }).map(({ measurement }) => measurement);
};
const rows = [...build(null), ...build({ encounter_identifier_field_key: null })].map((m) => ({
  family: m.family, method: m.calculationMethod, basis: m.basisVersion, key: m.measurementKey, definition: m.definition, field_keys: m.fieldKeys,
  value: m.measuredValue, counts: m.componentCounts, exclusions: m.exclusions,
}));
console.log(JSON.stringify(rows));
'''


def run(command, args, sql=None, expected_error=None):
    result = subprocess.run([str(BIN / command), *args], input=sql, text=True, capture_output=True, cwd=ROOT, env=ENV)
    if expected_error:
        assert result.returncode != 0 and expected_error in result.stderr, result.stderr
    elif result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout


def execute(sql, expected_error=None):
    return run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1'], sql, expected_error=expected_error)


def rows(sql):
    output = run('psql', ['-Xq', '--csv', '-v', 'ON_ERROR_STOP=1'], sql)
    return list(csv.DictReader(io.StringIO(output)))


def verifier(path):
    result = rows('BEGIN READ ONLY; SET LOCAL search_path = pg_catalog, kai, public;\n' + (ROOT / path).read_text() + '\nCOMMIT;')
    overall = next(row for row in result if row['check_id'] == 'OVERALL')
    assert overall['status'] == 'PASS', (path, [row for row in result if row['status'] == 'FAIL'])
    print(f'{path}: OVERALL PASS ({overall["detail"]})', flush=True)
    return result


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'"


def insert(row, *, expected_error=None, suffix=''):
    sql = f"""SET session_replication_role = replica;
INSERT INTO kai.source_derived_measurements (organization_id, source_version_id, worksheet_key, measurement_family, calculation_method, basis_version,
  measurement_key, definition, field_keys, measured_value, numerator, denominator, percentage, component_counts, exclusions, profile_canonical_sha256, created_by, created_by_type)
VALUES (gen_random_uuid(), gen_random_uuid(), NULL, '{row['family']}', '{row['method']}', '{row['basis']}', '{row['key'][:-len(suffix) or None]}{suffix}',
  {literal(row['definition'])}::jsonb, {literal(row['field_keys'])}::jsonb, {row['value']}, {row['value']}, NULL, NULL,
  {literal(row['counts'])}::jsonb, {literal(row['exclusions'])}::jsonb, repeat('a', 64), gen_random_uuid(), 'human');"""
    return execute(sql, expected_error=expected_error)


CONSTRAINTS = "SELECT conname, pg_get_constraintdef(oid) AS definition, convalidated FROM pg_constraint WHERE conrelid = 'kai.source_derived_measurements'::regclass ORDER BY conname"
started = False
work = Path(tempfile.mkdtemp(prefix='kai-service-events-', dir='/tmp'))
try:
    derived = json.loads(subprocess.run(['node', '--input-type=module', '-e', NODE], text=True, capture_output=True, cwd=ROOT,
                                        env={**ENV, 'DATABASE_URL': SENTINEL}, check=True).stdout)
    assert {row['family'] for row in derived} == {'service_events'} and len(derived) >= 8, derived
    (work / 'socket').mkdir()
    run('initdb', ['-D', str(work / 'data'), '--no-locale', '--encoding=UTF8', '--auth=trust'])
    run('pg_ctl', ['-D', str(work / 'data'), '-l', str(work / 'pg.log'), '-o', f'-k {work / "socket"} -h 127.0.0.1 -p {ENV["PGPORT"]}', 'start'])
    started = True
    run('createdb', [ENV['PGDATABASE']])
    identity = rows("SELECT current_database() AS db, inet_server_addr()::text AS host, current_setting('listen_addresses') AS listen, current_setting('server_version') AS version")[0]
    assert identity['db'] == ENV['PGDATABASE'] and identity['host'] in ('127.0.0.1', '127.0.0.1/32') and identity['listen'] == '127.0.0.1', identity
    print(f"Disposable PostgreSQL {identity['version']} on 127.0.0.1:{ENV['PGPORT']}", flush=True)
    execute('CREATE EXTENSION pgcrypto;')
    execute((ROOT / 'scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql').read_text())
    execute('ALTER TABLE kai.engagements ADD CONSTRAINT kai_plan_a_assembled_engagements_id_org_unique UNIQUE (engagement_id, organization_id);')
    execute((ROOT / 'scripts/kai-sprint2-package-4-impact-library-engagement-funder-requirements-auth-bootstrap-synthetic-schema.sql').read_text())
    execute((ROOT / 'scripts/kai-sprint2-intake-duplicate-resolution-production-shape-synthetic-schema.sql').read_text())
    chain_text = (ROOT / 'scripts/kai-sprint2-plan-a-migration-chain.js').read_text()
    chain = re.findall(r'"(kai_sprint2_[^"]+)"', chain_text.split('export const MIGRATION_CHAIN = [')[1].split('];')[0])
    refusals = {
        'kai_sprint2_legacy_generation_cutover_20260817': 'only accepts a fully-legacy pre-cutover state or its own fully-converged post-cutover state',
        'kai_sprint2_p1_06_review_status_column_repair': 'converged-state check failed: expected exactly 1 CHECK constraint governing review_status',
    }
    assert chain[-1] == SERVICE, chain[-3:]
    for name in chain[:-1]:
        if name in refusals:
            run('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1', '-f', str(ROOT / f'migrations/{name}.sql')], expected_error=refusals[name])
        else:
            execute((ROOT / f'migrations/{name}.sql').read_text())
    print(f'Applied {len(chain) - 1} chain migrations before {SERVICE} (two production-history repairs refused as expected)', flush=True)
    verifier('scripts/kai-reporting-schema-verify-read-only.sql')
    prior = rows(CONSTRAINTS)
    # Before the migration a service row is refused by the existing CHECKs.
    insert(derived[0], expected_error='violates check constraint')
    execute((ROOT / f'migrations/{SERVICE}.sql').read_text())
    execute((ROOT / f'migrations/{SERVICE}.sql').read_text())
    print('Upgrade applied twice (re-runnable)', flush=True)
    verifier('scripts/kai-service-event-measurements-verify-read-only.sql')
    verifier('scripts/kai-reporting-schema-verify-read-only.sql')
    for index, row in enumerate(derived):
        insert(row)
    print(f'Admitted {len(derived)} rows derived by the application (period, all-date, programme, activity, households, monthly, record mode)', flush=True)

    def broken(mutate, label):
        row = json.loads(json.dumps(derived[1]))
        mutate(row)
        insert(row, expected_error='violates check constraint', suffix='0')
        print(f'Refused: {label}', flush=True)

    broken(lambda r: r['counts'].update(excess_copy_record_count=r['counts']['excess_copy_record_count'] + 1), 'excess copies not equal to duplicate members minus groups')
    broken(lambda r: r['counts'].update(distinct_event_count=r['counts']['distinct_event_count'] + 1), 'distinct identities not physical minus blank minus excess')
    broken(lambda r: r['counts'].update(not_completed_event_count=r['counts']['not_completed_event_count'] + 1), 'completed plus not completed not equal to consistent identities')
    broken(lambda r: r['counts'].update(completed_outside_period_count=r['counts']['completed_outside_period_count'] - 1), 'in-scope encounters not completed minus exclusions')
    broken(lambda r: r.update(value=r['value'] + 1), 'measured value not its measured component')
    broken(lambda r: r['counts'].pop('completed_status_record_count'), 'a funnel count missing (a NULL would otherwise pass)')
    broken(lambda r: r['definition'].update(duplicate_policy='first_copy_wins'), 'a different duplicate policy')
    broken(lambda r: r['definition'].update(finding_basis='verified'), 'an unknown finding basis')
    broken(lambda r: r['definition']['period'].update(period_start='2026-04-01'), 'a period whose start is after its end')
    broken(lambda r: r['definition']['roles'].update(service_date=None), 'a period without a service date role')
    broken(lambda r: (r['definition'].update(period=None)), 'all dates with period exclusions')
    broken(lambda r: (r['definition']['roles'].update(encounter_identifier=None)), 'record mode with duplicate identities')
    broken(lambda r: r.update(method='kai_tabular_conditional_record_count_v1'), 'a service row posing as a raw row count')
    broken(lambda r: r.update(family='cross_source_reach', method='kai_cross_source_linked_reach_v1', basis='kai_cross_source_reconciliation_v1'), 'a service row posing as linked reach')
    broken(lambda r: r.update(family='tabular_count', method='kai_tabular_conditional_record_count_v1', basis='kai_tabular_measurement_basis_v1'), 'a service row posing as a raw row count (family, method and basis)')
    broken(lambda r: r['definition'].pop('period'), 'a definition without its period key (would be NULL)')
    broken(lambda r: r['definition'].pop('measured_component'), 'a definition without its measured component (would be NULL)')
    broken(lambda r: r['definition'].pop('finding_basis'), 'a definition without its finding basis (would be NULL)')
    entity = next(row for row in derived if row['definition']['metric'] == 'distinct_entities_served')
    row = json.loads(json.dumps(entity))
    row['definition']['roles']['entity_identifier'] = None
    insert(row, expected_error='violates check constraint', suffix='0')
    print('Refused: households stated without an entity identifier role', flush=True)
    row = json.loads(json.dumps(entity))
    row['counts']['distinct_entity_count'] = row['counts']['eligible_encounter_count'] + 1
    row['value'] = row['counts']['distinct_entity_count']
    insert(row, expected_error='violates check constraint', suffix='0')
    print('Refused: more households than in-scope encounters', flush=True)

    execute((ROOT / f'migrations/{SERVICE}.rollback.sql').read_text(), expected_error='service-event measurement rollback refused')
    print('Populated rollback refused', flush=True)
    execute("SET session_replication_role = replica; DELETE FROM kai.source_derived_measurements WHERE measurement_family = 'service_events';")
    execute((ROOT / f'migrations/{SERVICE}.rollback.sql').read_text())
    assert rows(CONSTRAINTS) == prior, 'rollback must restore every prior constraint definition exactly'
    print('Unused rollback restored every prior constraint definition exactly', flush=True)
    verifier('scripts/kai-reporting-schema-verify-read-only.sql')
    gone = rows('BEGIN READ ONLY;\n' + (ROOT / 'scripts/kai-service-event-measurements-verify-read-only.sql').read_text() + '\nCOMMIT;')
    assert next(row for row in gone if row['check_id'] == 'OVERALL')['status'] == 'FAIL', gone
    print('Dedicated verifier reports FAIL after rollback, as it must', flush=True)
    execute((ROOT / f'migrations/{SERVICE}.sql').read_text())
    for row in derived:
        insert(row)
    print(json.dumps(rows("SELECT conname, md5(jsonb_build_array(pg_get_constraintdef(oid), convalidated, condeferrable)::text) AS fingerprint FROM pg_constraint WHERE conrelid = 'kai.source_derived_measurements'::regclass AND conname IN ('source_derived_measurements_method_family_check','source_derived_measurements_arithmetic_check','source_derived_measurements_service_funnel_check') ORDER BY conname")), flush=True)
    verifier('scripts/kai-reporting-schema-verify-read-only.sql')
    verifier('scripts/kai-service-event-measurements-verify-read-only.sql')
    print('PASS: fresh chain, upgrade (twice), application rows admitted, broken rows refused, populated rollback refused, exact unused rollback, reapply, reporting verifier', flush=True)
finally:
    if started:
        run('pg_ctl', ['-D', str(work / 'data'), 'stop', '-m', 'fast'])
    shutil.rmtree(work)
    print('Disposable cluster removed', flush=True)
