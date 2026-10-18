import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";

// Private, public-qualified projections. Every authority read locks FOR SHARE;
// only the immutable delegation locator is deliberately nonlocking.
export function mcpAuthorityData<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>) {
  async function one<T extends Record<string, unknown>>(query: SQL): Promise<T | undefined> {
    // Runtime's PostgreSQL/Neon and the PGlite fixture all use the pg rows
    // result shape. A bare SQL source has no Drizzle table-column metadata.
    const result = await tx.execute(query) as unknown as { rows: T[] };
    return result.rows[0];
  }
  return {
    lockLimit: () => tx.execute(sql`set local lock_timeout = '2s'`),
    statementLimit: () => tx.execute(sql`set local statement_timeout = '5s'`),
    tenant: (id: string) => one<{ enabled: boolean }>(sql`select enabled from public.tenant where id=${id} for share`),
    user: (id: string) => one<{ verified: boolean }>(sql`select email_verified as verified from public."user" where id=${id} for share`),
    session: (id: string, user: string) => one<{ expires: number; created: number; google: number | null }>(sql`
      select floor(extract(epoch from (expires_at at time zone 'UTC'))*1000)::double precision as expires,
        floor(extract(epoch from (created_at at time zone 'UTC'))*1000)::double precision as created,
        floor(extract(epoch from (google_authenticated_at at time zone 'UTC'))*1000)::double precision as google
      from public.session where id=${id} and user_id=${user} for share`),
    membership: (tenant: string, user: string) => one<{ id: string; revision: number; enabled: boolean }>(sql`
      select id, authority_revision as revision, disabled_at is null as enabled from public.membership
      where tenant_id=${tenant} and user_id=${user} for share`),
    locator: (tenant: string, id: string) => one<{ grant: string; member: string }>(sql`
      select role_grant_id as grant, membership_id as member from public.mcp_delegation where tenant_id=${tenant} and id=${id}`),
    grant: (tenant: string, id: string, member: string) => one<{ role: string; revision: number; enabled: boolean }>(sql`
      select role, revision, revoked_at is null as enabled from public.role_grant
      where tenant_id=${tenant} and id=${id} and membership_id=${member} for share`),
    delegation: (tenant: string, id: string) => one<{
      user: string; session: string; member: string; grant: string; role: string; membershipRevision: number; grantRevision: number;
      client: string; resource: string; scope: string; consent: string | null; enabled: boolean; created: number; selection: number; hard: number; authorized: number | null;
    }>(sql`select user_id as "user", session_id as session, membership_id as member, role_grant_id as grant, role,
      membership_revision as "membershipRevision", grant_revision as "grantRevision", client_id as client, resource, scope, consent_id as consent,
      revoked_at is null as enabled, floor(extract(epoch from created_at)*1000)::double precision as created,
      floor(extract(epoch from selection_deadline)*1000)::double precision as selection,
      floor(extract(epoch from hard_deadline)*1000)::double precision as hard,
      floor(extract(epoch from authorized_at)*1000)::double precision as authorized
      from public.mcp_delegation where tenant_id=${tenant} and id=${id} for share`),
    client: (id: string) => one<{ valid: boolean }>(sql`select (
      name='Claude — CRC Beit Mitzvah' and user_id is null and reference_id is null and client_secret is null and client_discovery_id is null
      and disabled=false and skip_consent=false and require_pkce=true and dpop_bound_access_tokens=false
      and token_endpoint_auth_method='none' and application_type='web' and subject_type='public'
      and redirect_uris=array['https://claude.ai/api/mcp/auth_callback']::text[] and response_types=array['code']::text[]
      and grant_types=array['authorization_code']::text[] and scopes=array['portal:read']::text[] and client_credentials_scopes=array[]::text[]
      and enable_end_session is null and post_logout_redirect_uris is null and backchannel_logout_uri is null and backchannel_logout_session_required is null
      and jwks is null and jwks_uri is null and uri is null and icon is null and contacts is null and tos is null and policy is null
      and software_id is null and software_version is null and software_statement is null and metadata is null
    ) as valid from public.oauth_client where client_id=${id} for share`),
    resource: (id: string) => one<{ valid: boolean }>(sql`select (
      name='CRC Beit Mitzvah' and disabled=false and dpop_bound_access_tokens_required=false and policy_version=1
      and access_token_ttl=900 and allowed_scopes=array['portal:read']::text[] and refresh_token_ttl is null
      and signing_algorithm is null and signing_key_id is null and custom_claims is null and metadata is null
    ) as valid from public.oauth_resource where identifier=${id} for share`),
    link: (client: string, resource: string) => one<{ valid: boolean }>(sql`
      select metadata is null as valid from public.oauth_client_resource where client_id=${client} and resource_id=${resource} for share`),
    consent: (id: string, user: string, client: string, reference: string, resource: string) => one<{ valid: boolean }>(sql`
      select (user_id=${user} and client_id=${client} and reference_id=${reference} and resources=array[${resource}]::text[]
        and scopes=array['portal:read']::text[] and requested_user_info_claims=array[]::text[]) as valid
      from public.oauth_consent where id=${id} for share`),
    token: (hash: string, user: string, session: string, client: string, reference: string, resource: string) => one<{ valid: boolean; expires: number; created: number }>(sql`
      select (user_id=${user} and session_id=${session} and client_id=${client} and reference_id=${reference}
        and resources=array[${resource}]::text[] and scopes=array['portal:read']::text[] and requested_user_info_claims is null
        and refresh_id is null and confirmation is null and revoked is null
        and authorization_code_id is not null and octet_length(authorization_code_id) between 1 and 255
        and authorization_code_id=btrim(authorization_code_id) and authorization_code_id !~ '[[:cntrl:]]') as valid,
        floor(extract(epoch from (expires_at at time zone 'UTC'))*1000)::double precision as expires,
        floor(extract(epoch from (created_at at time zone 'UTC'))*1000)::double precision as created
      from public.oauth_access_token where token=${hash} for share`),
  };
}
