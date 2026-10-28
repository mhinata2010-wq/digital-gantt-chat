# 工程表UIの設計基準

対象ブランチ：feature/schedule-ui-next
目的：人が工程と日付をひと目で理解し、スマホでも迷わず操作できるWeb UI。

## 一次資料
- Material Design 3: https://m3.material.io/
- M3 Foundations: https://m3.material.io/foundations/
- M3 Adaptive layout examples: https://m3.material.io/foundations/layout/canonical-examples/overview
- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines/
- Apple Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Apple Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Google touch target guidance: https://developer.android.com/develop/ui/compose/accessibility/api-defaults

## このWebアプリへの適用方針
以下は公式の原則を工程表向けに解釈したプロジェクト内の判断であり、公式認証や完全準拠を意味しない。

1. 工程名・開始日・終了日を主役にし、紹介見出しや装飾的バナーを復活させない。
2. 検索は見える位置に固定し、絞り込み・期間移動・閲覧/編集の位置と表現を統一する。
3. 幅に応じて情報を再配置する。狭い画面はリスト、広い画面は工程表を基本とし、利用者が切り替えられる。
4. ホームの位置を固定し、選択状態でアイコンやボタンの位置・サイズを動かさない。
5. タッチ用の主要操作は48 CSS px程度の操作領域をプロジェクト目標とする。見た目のアイコンサイズと操作領域を分ける。Appleのpt、MaterialのdpをCSS pxと同じ単位だと説明しない。
6. 文字拡大・キーボード操作・フォーカス表示・支援技術のラベルを確認する。色だけで完了や選択状態を伝えない。
7. 操作の結果、該当なし、読込失敗、保存状態を文章でも伝える。推定日付・実績未確認を確定情報に見せない。
8. スマホのセーフエリアと下部ナビの高さを確保し、内容・ダイアログ・ボタンを隠さない。
9. 画面回転やフルスクリーンを強制しない。動きを減らす設定に対応する。
10. MaterialとAppleの外観を混在させること自体を目的にしない。緑の既存ブランドと統一されたWebコンポーネントを維持する。

## 変更前・変更後の確認
- 大幅なUI変更前に参考URL、採用要素、採用理由をユーザーへ提示する。
- 390px縦、844px横、デスクトップで、検索→工程発見→日付確認を実際に操作する。
- 初期表示で予定が見えるか、不要な見出しが領域を占有していないか確認する。
- 公開用ブランチへの統合は変更範囲と確認結果を説明する。このブランチの作成・設計文書の追加だけで公開画面を変更しない。

確認日：2026-10-28。ガイドラインは更新されるため、大幅変更時には関連項目を再確認する。
