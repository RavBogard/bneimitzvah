import { need, same, sha } from "./release-migrate-support.mjs";

// Only catalog metadata and server-side row counts/digests leave PostgreSQL.
// OIDs and generated FK-trigger names are not portable reference identities.
const ident = value => { need(typeof value === "string" && /^[a-z_][a-z0-9_]*$/.test(value)); return `"${value}"`; };
const order = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
export async function captureCatalog(client, owner) {
  const query = async (text, values = []) => (await client.query(text, values)).rows;
  await client.query("SET LOCAL search_path = pg_catalog, public");
  const relations = await query(`SELECT c.relname AS name,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    CASE WHEN r.rolname=$1 THEN '$OWNER' ELSE r.rolname END AS owner,c.relreplident AS replica_identity,
    c.relpersistence AS persistence,c.reloptions AS options,c.relnatts AS column_slots,c.relchecks AS check_count
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='public' AND c.relkind NOT IN ('i','I') ORDER BY c.relname LIMIT 129`, [owner]);
  need(relations.length <= 128 && relations.every(row => row.kind === "r" && row.owner === "$OWNER"));
  const tables = [];
  for (const relation of relations) {
    const name = relation.name;
    const columns = await query(`SELECT a.attnum AS position,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,
      CASE WHEN a.attcollation=0 THEN NULL ELSE cn.nspname||'.'||co.collname END AS collation,
      pg_get_expr(d.adbin,d.adrelid,true) AS default_expression
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
      WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [name]);
    need(columns.length <= 64);
    const notNull = await query(`SELECT co.conkey AS keys,co.convalidated AS valid,
      COALESCE((to_jsonb(co)->>'conenforced')::boolean,true) AS enforced
      FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=$1 AND co.contype='n'`, [name]);
    // PostgreSQL 18 materializes NOT NULL constraints separately. Exclude only
    // these rows, after proving they enforce the same column attnotnull bit.
    need(notNull.every(row => row.valid && row.enforced && row.keys?.length === 1 && columns.some(column => column.position === row.keys[0] && column.not_null)));
    const constraints = await query(`SELECT co.conname AS name,co.contype AS type,pg_get_constraintdef(co.oid,true) AS definition,
      co.conkey AS keys,co.confkey AS referenced_keys,co.condeferrable AS deferrable,co.condeferred AS deferred,
      co.convalidated AS valid,COALESCE((to_jsonb(co)->>'conenforced')::boolean,true) AS enforced,
      co.connoinherit AS no_inherit,co.conislocal AS local,co.coninhcount AS inherited_count,
      rn.nspname AS referenced_schema,rc.relname AS referenced_table
      FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_class rc ON rc.oid=co.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
      WHERE n.nspname='public' AND c.relname=$1 AND co.contype<>'n' ORDER BY co.conname`, [name]);
    const policies = await query(`SELECT p.polname AS name,p.polcmd AS command,p.polpermissive AS permissive,
      ARRAY(SELECT CASE WHEN x=0 THEN 'PUBLIC' ELSE r.rolname END FROM unnest(p.polroles) x LEFT JOIN pg_roles r ON r.oid=x ORDER BY 1) AS roles,
      pg_get_expr(p.polqual,p.polrelid,true) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid,true) AS check_expression
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=$1 ORDER BY p.polname`, [name]);
    const indexes = await query(`SELECT ic.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisunique AS unique,
      i.indisprimary AS primary,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live,i.indimmediate AS immediate
      FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid
      WHERE n.nspname='public' AND c.relname=$1 ORDER BY ic.relname`, [name]);
    const triggers = await query(`SELECT CASE WHEN t.tgisinternal THEN NULL ELSE t.tgname END AS name,t.tgisinternal AS internal,
      co.conname AS constraint_name,t.tgtype AS type,t.tgenabled AS enabled,t.tgattr::text AS columns,
      encode(t.tgargs,'hex') AS arguments,CASE WHEN t.tgqual IS NULL THEN NULL ELSE pg_get_triggerdef(t.oid,true) END AS condition,
      pn.nspname AS function_schema,p.proname AS function_name,t.tgdeferrable AS deferrable,t.tginitdeferred AS deferred
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace LEFT JOIN pg_constraint co ON co.oid=t.tgconstraint
      WHERE n.nspname='public' AND c.relname=$1`, [name]);
    need(triggers.every(row => !row.internal || row.constraint_name && row.function_schema === "pg_catalog" && /^RI_FKey_[a-z_]+$/.test(row.function_name) && row.columns === "" && row.condition === null));
    const grants = await query(`SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN r.rolname=$2 THEN '$OWNER' ELSE r.rolname END AS role,
      CASE WHEN g.rolname=$2 THEN '$OWNER' ELSE g.rolname END AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      LEFT JOIN pg_roles r ON r.oid=a.grantee LEFT JOIN pg_roles g ON g.oid=a.grantor WHERE n.nspname='public' AND c.relname=$1`, [name, owner]);
    const columnGrants = await query(`SELECT col.attname AS column,CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN r.rolname=$2 THEN '$OWNER' ELSE r.rolname END AS role,
      CASE WHEN g.rolname=$2 THEN '$OWNER' ELSE g.rolname END AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable
      FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a
      LEFT JOIN pg_roles r ON r.oid=a.grantee LEFT JOIN pg_roles g ON g.oid=a.grantor WHERE n.nspname='public' AND c.relname=$1 AND col.attnum>0 AND NOT col.attisdropped`, [name, owner]);
    // Ownership is checked separately. Owner implicit privileges include the
    // PG17+ MAINTAIN vocabulary; every non-owner grant remains exact.
    tables.push({ ...relation, columns, constraints, policies, indexes, triggers: order(triggers), grants: order(grants.filter(row => row.role !== "$OWNER")), columnGrants: order(columnGrants.filter(row => row.role !== "$OWNER")) });
  }
  const functions = await query(`SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS result,l.lanname AS language,p.prosrc AS source,p.probin AS binary,
    CASE WHEN r.rolname=$1 THEN '$OWNER' ELSE r.rolname END AS owner,p.prosecdef AS security_definer,
    p.provolatile AS volatility,p.proisstrict AS strict,p.proleakproof AS leakproof,p.proparallel AS parallel,
    p.prokind AS kind,p.proretset AS returns_set,p.proconfig AS config,
    (SELECT jsonb_agg(jsonb_build_object('role',CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN gr.rolname=$1 THEN '$OWNER' ELSE gr.rolname END,
      'grantor',CASE WHEN go.rolname=$1 THEN '$OWNER' ELSE go.rolname END,'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY a.grantee=0,gr.rolname,a.privilege_type) FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      LEFT JOIN pg_roles gr ON gr.oid=a.grantee LEFT JOIN pg_roles go ON go.oid=a.grantor) AS grants
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang JOIN pg_roles r ON r.oid=p.proowner
    WHERE n.nspname='public' ORDER BY p.proname,pg_get_function_identity_arguments(p.oid) LIMIT 129`, [owner]);
  need(functions.length <= 128 && functions.every(row => row.owner === "$OWNER"));
  // Object-key order from jsonb differs from row JSON; canonicalize for stable
  // reference comparisons without changing SQL/string bytes or identifiers.
  for (const fn of functions) fn.grants = order((fn.grants ?? []).filter(row => row.role !== "$OWNER"));
  const types = await query(`SELECT t.typname AS name,t.typtype AS kind,
    CASE WHEN r.rolname=$1 THEN '$OWNER' ELSE r.rolname END AS owner,
    CASE WHEN t.typelem=0 THEN NULL ELSE format_type(t.typelem,NULL) END AS element,
    ARRAY(SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid=t.oid ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_roles r ON r.oid=t.typowner
    WHERE n.nspname='public' ORDER BY t.typname LIMIT 257`, [owner]);
  need(types.length <= 256 && types.every(row => row.owner === "$OWNER" && (row.kind === "e" || row.kind === "c" || row.kind === "b" && row.element)));
  return canonical({ tables, functions, types });
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function referenceCatalog(catalog) {
  const digest = value => sha(Buffer.from(JSON.stringify(canonical(value))));
  return {
    format: "catalog-field-sha256-v1",
    tables: catalog.tables.map(table => ({ name: table.name, fields: Object.fromEntries(Object.keys(table).filter(key => key !== "name").sort().map(key => [key, digest(table[key])])) })),
    functions: catalog.functions.map(fn => ({ name: fn.name, arguments: fn.arguments, sha256: digest(fn) })),
    types: catalog.types.map(type => ({ name: type.name, sha256: digest(type) })),
  };
}
export function verifyCatalog(actual, reference) {
  need(same(canonical(reference.format === "catalog-field-sha256-v1" ? referenceCatalog(actual) : actual), canonical(reference)));
}
export async function captureRoles(client) {
  const roles = (await client.query(`SELECT oid::text AS oid,rolname AS name,rolsuper AS superuser,rolinherit AS inherit,
    rolcreaterole AS create_role,rolcreatedb AS create_db,rolcanlogin AS login,rolreplication AS replication,rolbypassrls AS bypass_rls,
    rolconnlimit AS connection_limit,rolconfig AS config FROM pg_roles ORDER BY oid`)).rows;
  const memberships = (await client.query(`SELECT roleid::text AS role,member::text AS member,grantor::text AS grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member,grantor`)).rows;
  const schemas = (await client.query(`SELECT nspname AS name,nspowner::text AS owner,nspacl::text AS acl FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%' ORDER BY nspname`)).rows;
  need(roles.length <= 256 && memberships.length <= 512 && schemas.length <= 128); return { roles, memberships, schemas };
}
export async function captureData(client, names) {
  const rows = [];
  for (const name of [...names].sort()) {
    const table = ident(name);
    const result = (await client.query(`WITH bounded AS (SELECT * FROM public.${table} LIMIT 100001), hashes AS
      (SELECT encode(sha256(convert_to(to_jsonb(bounded)::text,'UTF8')),'hex') AS value FROM bounded)
      SELECT count(*)::int AS count,encode(sha256(convert_to(COALESCE(string_agg(value,'' ORDER BY value),''),'UTF8')),'hex') AS digest FROM hashes`)).rows[0];
    need(Number.isInteger(result?.count) && result.count <= 100000 && /^[a-f0-9]{64}$/.test(result.digest)); rows.push({ name, ...result });
  }
  return rows;
}
