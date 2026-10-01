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
- 編集者は天候休工の変更案を提出できるが、自分で正式日程へ確定できない。
- 責任者が天候変更を承認すると、対象工程の休工日と日数が同一トランザクションで更新される。
- 天候変更案へ許可されていない列を混ぜると、DB側で拒否される。
- 建築ネットワークのイベント配置は案件メンバーだけが参照でき、編集者以上だけが保存・リセットできる。
- APIから`created_by`／`updated_by`へ他人のUUIDを指定しても、DBがログイン本人へ上書きする。
- MIME名だけを偽装した画像・PDFは`upload-project-file`で拒否される。
- JavaScript、起動アクション、埋込ファイルを含むPDFは拒否される。
- 招待IDと異なる招待トークンをメール送信APIへ渡すと拒否される。
- 編集者は数量・歩掛・班数・人員・金額・棟・階を更新でき、閲覧者は更新できない。
- 工程取込RPCが建築士用の数量・歩掛・班数・人員・金額・棟・階を欠落させない。
- 案件の構造・規模、休日方針、月別天候余裕、準備チェックは責任者だけが更新できる。
- アップロード実行者以外（責任者を含む）は未登録ファイルをcleanup APIで削除できず、登録済み添付は作成者でも同APIから物理削除できない。
- 添付登録とcleanupを同時実行しても、DB予約行のロックにより「登録済みなのにStorageだけ消える」状態にならない。
- 存在しない工程、別案件の工程、削除済み工程、存在しない管理項目を指定したアップロードは拒否される。
- 同一利用者100件／時、同一案件300件／時、案件5GiB、利用者10GiB、案件5000件、利用者10000件のいずれかを超える予約は拒否される。
- 同じ案件・宛先への招待メールは5分以内に再送できず、同時要求でも1件だけが送信権を取得する。
- 招待を作り直しても案件・正規化メール単位のクールダウンを回避できず、送信者20件／時・受信者5件／時・招待10件の上限が働く。
