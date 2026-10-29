# Operational UI 実装手順

## 目的

`digital-gantt-chat` を機能一覧型の工程表アプリから、現場の状態・差分・影響・次の対応を素早く判断できる **Construction Operational UI** へ段階的に移行する。

コアモデルは以下とする。

```text
STATUS -> DELTA -> IMPACT -> ACTION
```

- **STATUS**: 現場・工程の現在状態
- **DELTA**: 予定と実績の差分
- **IMPACT**: 後続工程・関係会社・納期への影響
- **ACTION**: 監督が次に判断・実行すべきこと

## 参考原則

### Grafana Loki Operational UI

参考にするのはビジュアルのコピーではなく、運用担当者が「状態を確認し、その場で掘り下げ、必要な操作を行う」情報設計。

採用する要素:

- 状態の集約表示
- 異常・要対応を通常状態より優先
- 一覧から詳細へ段階的に掘り下げる
- 判断と操作を同じコンテキストで行える

### Apple Human Interface Guidelines

採用する要素:

- 明確な視覚的階層
- 現在状態が一目で分かるフィードバック
- Top-level navigation と Action の役割を混同しない
- モバイルでは主要情報と主要操作を優先する

## 実装方針

### 0. 基準ブランチを固定

- Repository: `mhinata2010-wq/digital-gantt-chat`
- Base: `main`
- Feature Branch: `feature/operational-ui`
- PR: `#16 Define operational UI product direction`

既存の `feature/receipt-links` や `experiment/schedule-only` とは混ぜない。

## 1. 現状確認

実装前に以下を確認する。

- `main` の最新SHA
- Open PR
- 既存Branch
- `index.html`
- `app.js`
- `field-dashboard.js`
- `field-operations.js`
- `style.css`
- 既存のToday / Gantt / Network導線

### 現時点で再利用できるもの

- `categorizeFieldTasks()` の遅延・要確認・進行中分類
- `scheduleState()` による状態判定
- `progressOf()` による実績進捗
- 既存の変更影響確認
- 後続工程依存関係
- Human-in-the-loop の変更承認フロー

## 2. 先に独立プロトタイプを作る

既存画面へ直接大改修を入れず、まず `operational-prototype.html` でUI仮説を検証する。

理由:

1. 現行機能を壊さない
2. 情報設計を先に評価できる
3. モバイルとデスクトップを比較できる
4. 不要な機能を実装前に捨てられる

## 3. First View の優先順位

画面を開いて最初に答えられるべき質問を次の順番にする。

1. 今日、現場は正常か
2. 何件対応が必要か
3. 予定との差は何か
4. 何へ影響するか
5. 次に何を判断するか

工程表そのものは最初の回答ではなく、詳細確認のためのビューとして扱う。

## 4. Site Status

上部に現場全体の状態を表示する。

表示候補:

- 正常工程数
- 要確認工程数
- 遅延工程数
- 今日の作業数
- 確認待ち変更案

ただしカードを大量に並べない。最重要状態を1つのStatus Headerで表現する。

## 5. Attention Queue

監督が今日判断すべき項目を優先度順に並べる。

優先順位の例:

1. クリティカル工程の遅延
2. 今日が期限の確認事項
3. 後続工程へ影響する遅延
4. 担当未設定
5. 近日期限の管理項目

各項目は最低限以下を持つ。

- 何が起きているか
- 予定との差
- 影響先
- 次のAction

## 6. Delta 表示

単なる「遅延」ではなく、予定と実績の差分を具体的に表示する。

例:

```text
外壁工事
予定 100% / 実績 72%
DELTA -28pt
```

日程差がある場合:

```text
予定完了 10/29
見込完了 10/31
DELTA +2日
```

## 7. Impact 表示

すべての依存関係を最初から見せない。

Collapsed:

```text
後続2工程に影響
```

Expanded:

```text
シーリング +2日
足場解体 +2日
```

必要な時だけNetwork / Ganttへ遷移する Progressive Disclosure を採用する。

## 8. Action

AIやシステムが勝手に正式日程を変更しない。

候補Action:

- 予定通り進める
- 日程変更案を見る
- 担当者へ確認
- 進捗を報告
- 変更案を責任者へ送る

最終確定は責任者が行う。

## 9. Navigation

現状のFeature Navigationを段階的にTask / State Navigationへ寄せる。

### Top-level

- 状態
- 今日
- 工程
- 案件

### 工程の内部View

- Gantt
- Network
- 一覧

Gantt / Network / 一覧をTop-levelで同列に扱わない。

## 10. Mobile First

現場利用では以下を優先する。

- 片手操作
- 44px以上を目安とするタップ領域
- 横スクロールを主要操作にしない
- 状態色だけに意味を依存しない
- 屋外でも判別しやすいコントラスト
- Actionを画面下部に寄せすぎない
- 重要な数値はラベルとセットで表示

## 11. AIの役割

AIを主要NavigationやチャットUIにしない。

AIを使う場合の優先用途:

1. 現場報告テキストの構造化
2. 遅延理由の分類補助
3. 次に確認すべき対象の候補生成
4. 過去の類似ケース検索

AIの提案は必ず監督が確認できる状態にする。

## 12. 段階実装

### Phase 1: Prototype

- Site Status
- Attention Queue
- Delta
- Impact
- Action
- Mobile responsive

### Phase 2: Existing app integration

- Today画面へStatus Headerを統合
- `categorizeFieldTasks()` の結果をAttention Queueへ利用
- 既存Impact計算を接続
- 既存進捗報告ダイアログをActionへ接続

### Phase 3: Navigation refactor

- Today / Status中心へNavigationを再編
- Gantt / Network / Tasksを工程内部へ統合

### Phase 4: Real-site validation

5〜10現場で以下を計測する。

- 要対応を見つけるまでの時間
- 工程変更判断までの時間
- 関係者調整にかかった時間
- 見落とした要対応件数
- 1日あたりの操作回数

## KPI

Primary:

- **工程変更・確認・関係者調整に要する時間**

Secondary:

- Attention Queueの未解決件数
- 期限超過件数
- 現場報告から判断までの時間
- 変更案から確定までの時間

工程表の編集回数自体はPrimary KPIにしない。

## Non-goals

この段階では以下を行わない。

- AIによる自動日程確定
- 会計・請求機能の全面統合
- 既存Network/Ganttロジックの全面書き直し
- すべての画面の同時リニューアル
- Grafana UIの直接コピー

## PR運用ルール

Pull Requestを作る場合はDescriptionを空欄にしない。

最低限以下を記載する。

```md
## Summary
このPRの目的

## Changes
- 主な変更内容

## Testing
- 実施した確認
- テスト結果

## Notes
- 注意事項
- 未対応事項
- レビュアーに確認してほしい点
```

`No description provided.` のPRは作らない。
