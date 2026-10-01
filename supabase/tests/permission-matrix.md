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
| Report progress / complete task | allow | allow | deny | deny |
| Read comments and private attachments | allow | allow | allow | deny |
| Post comments / upload attachments | allow | allow | deny | deny |
| Create or restore a schedule version | allow | deny | deny | deny |
| Read schedule versions | allow | allow | allow | deny |
| Create/update management items | allow | allow | deny | deny |
| Delete management items | allow | deny | deny | deny |
| Read another user's notifications | deny | deny | deny | deny |
| Create/revoke invitation tokens | allow | deny | deny | deny |
| Accept invitation with mismatched email | deny | deny | deny | deny |
| Open Storage object URL without signed member access | deny | deny | deny | deny |
| Hard-delete task rows / cascade field evidence | deny | deny | deny | deny |
| Soft-delete an active task through the app | allow | allow | deny | deny |
| Modify another user's notification or preferences | deny | deny | deny | deny |

Also open the same task in two authenticated browsers. Save from browser A, then save the stale copy from browser B. The second update must return no row and the UI must show the conflict message instead of overwriting A's change.

Create a schedule version after reports and attachments exist, change the schedule, and restore the version. The report, comment and attachment records must remain in the database; tasks not present in the restored version must have `archived_at` set instead of being physically deleted.
# ハイブリッド工程取込・配置調整

- 閲覧者が `apply_schedule_import` を呼ぶと拒否される。
- 編集者が警告のない候補を取り込むと、同一トランザクションで工程と前工程が作成される。
- 既存または取込内で工程記号が重複すると、全行がロールバックされる。
- 別案件の工程記号を前工程として指定しても参照されない。
- 閲覧者と未参加者は `network_task_layouts` を更新できない。
- 編集者が保存した配置を別端末の案件メンバーが読み取れる。
