# Summary 13-02: Project Browsing MCP Tools

**Status:** Complete
**Files Created:** 1
**Files Modified:** 3 (server.ts, tiers.ts, ai/tools.ts)
**Lines Added:** ~450

## What Was Built

`src/mcp/tools/projects.ts` -- 4 GREEN tier MCP tools for project intelligence.

### Tools
1. **list_projects** -- Lists all 24 projects as flat sorted cards with optional text filter
2. **get_project_structure** -- Directory tree via local fs (Home) or SSH find (remote), maxDepth configurable
3. **read_project_file** -- Read source files with secret blocking + path traversal prevention, 1MB limit
4. **search_project_files** -- grep -rn across project files, excludes noise dirs, secret file filtering, max 100 results

### 3-Place Registration
- MCP handler: `src/mcp/tools/projects.ts` (registerProjectTools)
- Tier mapping: `src/safety/tiers.ts` (4 GREEN entries)
- Claude descriptions: `src/ai/tools.ts` (4 tool descriptions with usage hints)
- Server import: `src/mcp/server.ts` (import + registration call)

### Design Decisions
- Flat sorted list per user preference
- Full card per project (name, node, type, path, description, version, lastModified)
- Node name mapping: registry lowercase → config case-sensitive ("home" → "Home")
- Local fs for Home node, SSH for remote nodes
- Tree view filters: noise files, skip dirs, secret files
- Total tool count: 23 → 27
