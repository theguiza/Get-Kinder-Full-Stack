/**
 * Provenance marker kaiActorContext sets on every organization membership it
 * read from kai.organization_memberships (a stored grant). Binding-derived
 * memberships carry "gk_organization_binding" (gkOrganizationBindingAuthority.js).
 * Kept dependency-free so the pure authorization service can import it.
 */
export const STORED_ORGANIZATION_MEMBERSHIP_SOURCE = "kai_organization_membership";
