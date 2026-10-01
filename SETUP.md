# 共同編集バックエンドと公開の設定

GitHub Pagesは静的フロントエンドだけを配信します。認証、共有データ、権限検証、履歴、ファイル、リアルタイム同期はSupabaseで動きます。

## 1. データベースを作成・更新する

新規環境ではSupabase SQL Editorで1〜5を番号順に実行し、5章の`upload-project-file`をデプロイしてから6〜8を実行します。

1. `supabase/migrations/202609280001_collaboration.sql`
2. `supabase/migrations/202609290001_field_operations.sql`
3. `supabase/migrations/202610010001_hybrid_schedule_import.sql`
4. `supabase/migrations/202610010002_weather_schedule_changes.sql`
5. `supabase/migrations/202610010003_event_network_layout.sql`
6. `supabase/migrations/202610010004_security_hardening.sql`
7. `supabase/migrations/202610010005_architect_schedule_fields.sql`
8. `supabase/migrations/202610010006_security_rate_limits.sql`

既に現場運用版を使っている環境では3〜5、`upload-project-file`のデプロイ、6〜8の順に実行します。`202610010004_security_hardening.sql`を適用するとStorageへの直接書込みを停止します。各追加移行は既存案件・工程を削除しません。実行後は次が作成されます。

- 進捗／完了報告、コメント、添付
- 工程版と版内スナップショット
- 発注・承認・検査・是正などの管理項目
- 通知、通知設定、期限付き招待
- 非公開Storage bucket `project-files`
- 各テーブルとStorageのRLS、監査トリガー、Realtime対象
- Excel／読取結果の取込履歴、安全な一括追加RPC
- ネットワーク図の共有手動配置
- 天候休工日と遅延理由を含む変更案・影響経路・責任者承認
- 番号付きイベント、工程矢線、ダミー線を持つ建築ネットワークと共有手動配置
- 天候変更制約の整合、作成者情報のDB強制、添付ファイルのサーバー検査
- 数量・歩掛・班数・人員・金額・棟・階、案件条件、月別天候余裕、準備チェック

移行が未適用でも旧共同編集機能は動きますが、現場報告・工程版・管理項目・通知は表示されません。これは公開中サイトを壊さないための互換動作です。

## 2. 認証URLを設定する

Authentication → URL Configuration:

- Site URL: `https://mhinata2010-wq.github.io/digital-gantt-chat/`
- Redirect URLs:
  - `https://mhinata2010-wq.github.io/digital-gantt-chat/**`
  - `http://localhost:4173/**`

Authentication → Providers → Emailでメール認証を有効にします。本番ではメール確認を有効にしてください。

## 3. 公開キーを設定する

Project Settings → APIのProject URLとpublishable keyを `config.js` に設定します。

```js
window.SNAKE_CONFIG={
  supabaseUrl:'https://xxxxx.supabase.co',
  supabasePublishableKey:'sb_publishable_xxxxx'
};
```

publishable keyは公開してよいキーで、RLSと組み合わせて使います。DBパスワード、SMTPパスワード、Resend API key、LINE token、`service_role` keyは `config.js` やGitへ絶対に保存しません。

## 4. 認証メールをsnake site名義にする（任意）

Gmailアドレスは利用者のログイン先メールとして使用できます。一方、安定した送信元と件名／本文の編集には独自SMTPと、通常は送信元ドメインの確認が必要です。ドメインがない間はSupabase標準メールを使用し、件名は標準のまま運用できます。

独自SMTPを使う場合はAuthentication → SMTP SettingsでSMTP事業者の値を設定し、Sender nameを `snake site` にします。その後Authentication → Email Templates → Confirm sign upで以下を設定します。

- Subject: `【snake site】メールアドレスの確認`
- Body: `supabase/email-templates/confirmation.html`

## 5. Edge Functions

添付ファイルを利用する場合、`upload-project-file`は必須です。ログイン本人と案件権限を確認し、サイズ、実ファイル署名、危険なPDFアクションを検査してから非公開Storageへ保存します。`SUPABASE_SERVICE_ROLE_KEY`はSupabaseがEdge Function環境へ提供する値を使用し、ブラウザやGitには保存しません。

```sh
supabase functions deploy upload-project-file
supabase secrets set PUBLIC_SITE_URL=https://mhinata2010-wq.github.io/digital-gantt-chat/
```

招待リンク／QRは外部メールサービスなしでも作成できます。メールを自動送信する場合だけ`send-invitation`もデプロイします。

```sh
supabase functions deploy send-invitation
supabase secrets set RESEND_API_KEY=... INVITE_FROM_EMAIL=... PUBLIC_SITE_URL=https://mhinata2010-wq.github.io/digital-gantt-chat/
```

`INVITE_FROM_EMAIL` はResendで確認済みの送信元を使います。未設定時、画面は「送信済み」と表示せず、招待リンクを手渡しする案内を出します。LINE通知は設定項目だけを用意しており、Messaging APIの配信処理はまだ接続していません。

## 6. セキュリティと権限を確認する

`supabase/tests/permission-matrix.md`を別アカウント／別ブラウザで確認します。

- 閲覧者の更新はUIだけでなくDBで拒否される。
- 未招待者は案件UUIDを知っていても取得できない。
- 編集者は工程と現場報告を変更できるが、権限変更と版復元はできない。
- 招待リンクは期限付き・一度限りで、招待メールとログインメールが一致しないと受理できない。
- 添付は公開URLではなく、案件メンバーだけが署名URLで閲覧できる。
- 古い画面とオフライン報告は、競合時に他人の変更を上書きしない。

## 7. ローカル確認

```sh
npm run check
npm test
python3 -m http.server 4173
```

`http://localhost:4173` を開きます。`file://` ではService Worker、認証リダイレクト、一部モジュール動作を正しく検証できません。

二端末確認:

1. 責任者が案件を作成し、編集者と閲覧者を招待。
2. 別ブラウザプロファイルで招待を受理。
3. 編集者がスマートフォン幅で着手・進捗・完了を報告。
4. 責任者側の今日、ガント、ネットワーク、履歴へ反映されることを確認。
5. 閲覧者と未招待者の更新／閲覧拒否を確認。
6. 二人で同じ工程を開き、後から保存した古い版が競合になることを確認。
7. オフライン報告後に別端末で同工程を更新し、再接続時に比較画面が出ることを確認。
8. 再読み込み後も報告・履歴・添付・版が残ることを確認。
9. `03作業リスト`を含むExcelを候補表示し、警告行が登録されないことを確認。
10. ネットワーク図をドラッグし、別端末の再読み込み後も配置が残ることを確認。

## 8. GitHub Pagesへ公開する

現在の公開URLは `https://mhinata2010-wq.github.io/digital-gantt-chat/` です。公開元を変更する前にステージングまたは作業ブランチで確認してください。同じURLへ公開する場合、既存ブックマークは維持されますが、利用者の次回再読み込みから新しいアプリシェルへ更新されます。

GitHub Settings → Pages → Build and deploymentで公開元を選びます。Supabase URL設定を先に済ませ、`service_role`や外部サービス秘密情報が追跡ファイルにないことを確認してから公開します。

## 9. 外部サービスと残る制約

- Supabase: 共同編集、Auth、DB、Realtime、Storageに必須。
- Resend／SMTP: メール自動送信とブランドメールに任意。
- LINE Messaging API: 現在は未接続。チェックを保存してもLINEへは送信しません。
- ブラウザ通知: 利用者が明示的に許可した端末で設定を保存します。Web Pushのバックグラウンド配信は未実装です。
- PWA: アプリ本体と直近案件を参照できます。写真アップロードはオフライン不可。オフライン報告は端末内に暗号化されないため、共有端末では必ずログアウトしてください。ログアウト時に利用者別キャッシュを削除します。
