import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaPath = resolve(__dirname, 'prisma/schema.prisma');
const migrationsPath = resolve(__dirname, 'prisma/migrations');
const schema = readFileSync(schemaPath, 'utf8');
const migrationSql = readdirSync(migrationsPath, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => readFileSync(resolve(migrationsPath, entry.name, 'migration.sql'), 'utf8'))
  .join('\n');

function prismaTableNames(source: string) {
  return [...source.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)].map(([, modelName, body]) => {
    const mapped = body.match(/@@map\("([^"]+)"\)/)?.[1];
    return mapped ?? modelName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  });
}

function rlsEnabledTableNames(source: string) {
  const names = new Set<string>();
  for (const [, tableName] of source.matchAll(/ALTER\s+TABLE\s+"?([a-z_][a-z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)) {
    names.add(tableName.toLowerCase());
  }
  const initialPolicyLoop = source.match(/FOREACH\s+t\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]\s+LOOP/i)?.[1] ?? '';
  for (const [, tableName] of initialPolicyLoop.matchAll(/'([a-z_][a-z0-9_]*)'/g)) names.add(tableName);
  return names;
}

describe('Prisma schema row-level security coverage', () => {
  it('persists campaign visual editor state alongside its delivery content',()=>{
    const campaign=schema.match(/^model Campaign \{([\s\S]*?)^\}/m)?.[1]??'';
    expect(campaign).toMatch(/editorJson Json\? @map\("editor_json"\)/);
    expect(migrationSql).toMatch(/ALTER TABLE campaigns ADD COLUMN editor_json JSONB/i);
  });
  it('keeps every persisted model behind RLS', () => {
    const rlsTables = rlsEnabledTableNames(migrationSql);
    const unprotected = prismaTableNames(schema).filter(table => !rlsTables.has(table));
    expect(unprotected).toEqual([]);
  });

  it('backfills memberships and lets sessions move only across existing memberships', () => {
    const membership = migrationSql.match(/CREATE TABLE organization_memberships \(([\s\S]*?)\);/i)?.[1] ?? '';
    expect(membership).toMatch(/PRIMARY KEY \(tenant_id, user_id\)/i);
    expect(migrationSql).toMatch(/INSERT INTO organization_memberships[\s\S]*?SELECT tenant_id,\s*id,\s*role[\s\S]*?FROM users;/i);
    expect(migrationSql).toMatch(/DROP CONSTRAINT sessions_tenant_id_user_id_fkey/i);
    expect(migrationSql).toMatch(/FOREIGN KEY \(tenant_id,\s*user_id\)\s+REFERENCES organization_memberships\(tenant_id,\s*user_id\)/i);
    expect(migrationSql).toMatch(/CREATE POLICY organization_membership_scope[\s\S]*?app\.auth_user_id/i);
    expect(schema).toMatch(/membership OrganizationMembership @relation\("SessionMembership",\s*fields:\s*\[tenantId,\s*userId\],\s*references:\s*\[tenantId,\s*userId\]/);
  });

  it('requires every one-time capability to carry a tenant scope', () => {
    const tokenModel = schema.match(/^model OneTimeToken \{([\s\S]*?)^\}/m)?.[1] ?? '';
    expect(tokenModel).toMatch(/^\s*tenantId String @map\("tenant_id"\)/m);
    expect(migrationSql).toMatch(/UPDATE one_time_tokens AS token[\s\S]*?SET tenant_id = account\.tenant_id[\s\S]*?WHERE account\.id = token\.user_id[\s\S]*?AND token\.tenant_id IS NULL/i);
    expect(migrationSql).toMatch(/ALTER TABLE one_time_tokens\s+ALTER COLUMN tenant_id SET NOT NULL/i);
  });
});
