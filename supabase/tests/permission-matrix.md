# RLS integration test matrix

Run the checks below against a disposable Supabase project after applying the migration. Use three separate browser profiles or authenticated clients.

| Operation | Owner | Editor | Viewer | Uninvited |
|---|---:|---:|---:|---:|
| Read project/tasks/history | allow | allow | allow | deny/empty |
| Create/update/delete task | allow | allow | deny | deny |
| Update project settings | allow | deny | deny | deny |
| Invite/change/remove member | allow | deny | deny | deny |
| Change/delete owner membership | deny | deny | deny | deny |
| Read a different project | only if member | only if member | only if member | deny/empty |

Also open the same task in two authenticated browsers. Save from browser A, then save the stale copy from browser B. The second update must return no row and the UI must show the conflict message instead of overwriting A's change.
