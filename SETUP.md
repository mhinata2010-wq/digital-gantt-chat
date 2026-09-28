# 共同編集バックエンドと公開の設定

GitHub Pagesは静的ファイルの配信だけを担当します。認証・共有データ・権限検証・リアルタイム同期はSupabaseで動きます。

## 1. Supabaseプロジェクトを作る

1. Supabaseで新しいプロジェクトを作成します。
2. SQL Editorで `supabase/migrations/202609280001_collaboration.sql` を実行します。
3. Authentication → URL Configurationで次を登録します。
   - Site URL: 実際のGitHub Pages URL
   - Redirect URLs: 実際のGitHub Pages URLとローカルの `http://localhost:4173/**`
4. Authentication → Providers → Emailでメール認証を有効にします。本番ではメール確認を有効にしてください。

## 2. 公開キーを設定する

Project Settings → APIで次を確認し、`config.js`に設定します。

```js
window.SNAKE_CONFIG={
  supabaseUrl:'https://xxxxx.supabase.co',
  supabasePublishableKey:'sb_publishable_xxxxx'
};
```

publishable key（または旧形式のanon key）はRLSと組み合わせてブラウザで使う公開キーです。`service_role`キーはRLSを迂回するため、絶対に`config.js`やGitHubへ保存しないでください。

## 3. セキュリティ確認

`supabase/tests/permission-matrix.md`の権限表を、責任者・編集者・閲覧者・未招待者の4条件で確認します。特に次を確認します。

- 閲覧者の工程更新がデータベースで拒否される。
- 未招待者はURLやUUIDを知っていても案件を取得できない。
- 編集者は工程を編集できるが、メンバー権限や案件設定を変更できない。
- 古い画面からの更新は競合として止まり、他人の変更を上書きしない。

## 4. GitHub Pagesへ公開する

現在の公開元を変更する前に、既存サイトへの影響を確認してください。`feature/collaborative-schedule`をPagesの公開元にすると、現在の`feature/network-schedule`版が統合版へ置き換わります。URLが同じ場合、既存のブックマークは維持されます。

公開前に作業ブランチで動作確認し、その後 GitHub Settings → Pages → Build and deployment で公開元を変更します。

## 5. 二端末確認

1. 責任者アカウントで案件を作成し、編集者と閲覧者のメールを招待します。
2. 別ブラウザプロファイルで各メールのアカウントを作成・ログインします。
3. 編集者が工程を更新し、責任者側へ自動反映されることを確認します。
4. 閲覧者の画面に編集操作がなく、APIからの更新もRLSで拒否されることを確認します。
5. 両方で同じ工程を開き、先に保存した側だけが成功することを確認します。
