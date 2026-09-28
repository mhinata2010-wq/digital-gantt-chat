# digital-gantt-chat

一つの案件・一つの工程データを、ガントチャートとネットワーク図の二つの表示で共有する建設工程表です。

## 構成

- フロントエンド: Vanilla HTML / CSS / JavaScript（GitHub Pagesで配信可能）
- 認証: Supabase Auth（メールアドレス＋パスワード）
- データ: Supabase Postgres
- 権限: Postgres Row Level Security（案件単位の責任者・編集者・閲覧者）
- 同期: Supabase Realtime
- 競合対策: `projects.revision` / `tasks.version` を使った楽観的ロック
- 履歴: DBトリガーによる案件・工程・メンバー変更の監査ログ

## 重要な設計

`tasks`テーブルだけが工程の正本です。ガントチャートとネットワーク図は、どちらも同じレコードを`computeSchedule()`へ渡して描画します。別画面用の工程データは作りません。

案件を開くと「今日の現場」を最初に表示し、今日・遅れ・次の工程を確認できます。工程の追加入口は画面上部の「＋ 工程」だけです。今日、ガント、ネットワーク、工程一覧のどこで工程をタップしても同じ詳細画面が開きます。編集権限がある利用者はガントまたは一覧から完了報告でき、閲覧者には更新操作を表示しません。

ブラウザにはSupabaseのセッションだけを保持します。アプリ独自のパスワードやパスワードハッシュは`localStorage`へ保存しません。公開可能なSupabase publishable keyだけをフロントエンドで使い、実際のアクセス可否はデータベースのRLSが判定します。`service_role`キーをブラウザへ置かないでください。

## 開発・テスト

```sh
npm test
npm run check
python3 -m http.server 4173
```

ブラウザで `http://localhost:4173` を開きます。共同編集を動かすには先に [SETUP.md](SETUP.md) のバックエンド設定が必要です。

## 既存データの移行

ログインしたメールアドレスに一致する旧ローカルアカウントの所有案件（`snake_projects_v1`）と、旧ネットワーク工程表（`snake_network_schedule_v1`）を検出します。「データを移行」を押すと共有DBへコピーします。移行後も元の`localStorage`は削除しません。

旧アプリのパスワードハッシュは安全上移行しません。Supabase Authで同じメールアドレスのアカウントを作成し直してください。

## ブランチ

- `main`: 既存のガントチャート
- `feature/field-share`: 調査時点では`main`と同一
- `feature/network-schedule`: 独立したネットワーク工程表
- `feature/collaborative-schedule`: 共同編集と統合表示（この実装）
