import type { OAuthPermissionLevel } from "admin/rest_api";

// The permission levels a user can grant to an MCP client, see security.Scope.Set.forLevel in the backend. They are
// ordered: each level also grants everything the ones before it grant.
export const OAUTH_PERMISSION_LEVELS: ReadonlyArray<{
  key: OAuthPermissionLevel;
  label: string;
  description: string;
}> = [
  {
    key: "read",
    label: "Read",
    description: "Look at datasets, annotations and tasks. The agent cannot change anything.",
  },
  {
    key: "write",
    label: "Create/modify",
    description:
      "Additionally upload and edit datasets, and create annotations, tasks, projects and teams. Cannot change the organization.",
  },
  {
    key: "delete",
    label: "Delete",
    description: "Additionally delete datasets, annotations, tasks and teams. Use with care.",
  },
];

export function getPermissionLevelLabel(level: string): string {
  return OAUTH_PERMISSION_LEVELS.find((candidate) => candidate.key === level)?.label ?? level;
}
