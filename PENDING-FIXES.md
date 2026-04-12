# FEELDSCOPE-OGN 未適用パッチ

FEELDSCOPE-new で 2026-04-12 に修正した内容。FEELDSCOPE-OGN にも同様の修正が必要。

---

## 1. 滑空場設定のサーバーサイド保存

### 問題
滑空場の名前・座標を設定画面で変更しても、ページリロードで元に戻る。
原因: 設定がブラウザの `localStorage` にのみ保存されており、SSR時に `DEFAULT_UNITS`（ハードコードされた関宿滑空場）で上書きされるため。

### 修正対象ファイル
`webapp/src/lib/UnitContext.tsx`

### 修正内容

#### a) 初期ロード時にサーバーから読み込み

`useEffect` 内の `loadUnits()` 呼び出しを変更し、`/api/system` からサーバー側の `airfield_config` を取得して localStorage より優先する。

```tsx
// 変更前
useEffect(() => {
  setUnits(loadUnits());
  setUnitsLoaded(true);
}, []);

// 変更後
useEffect(() => {
  const local = loadUnits();
  fetch("/api/system")
    .then((res) => res.json())
    .then((data) => {
      if (data.airfield_config) {
        setUnits({ ...local, airfield: data.airfield_config });
      } else {
        setUnits(local);
      }
      setUnitsLoaded(true);
    })
    .catch(() => {
      setUnits(local);
      setUnitsLoaded(true);
    });
}, []);
```

#### b) setAirfield でサーバーAPIにも保存

`update()` とは別に `updateAirfield()` 関数を追加し、サーバーの `airfield-save` アクションを呼ぶ。

```tsx
function updateAirfield(airfield: AirfieldConfig) {
  const next = { ...units, airfield };
  setUnits(next);
  saveUnits(next);
  fetch("/api/system", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "airfield-save",
      name: airfield.name,
      latitude: airfield.latitude,
      longitude: airfield.longitude,
      elevation_m: airfield.elevation_m,
    }),
  }).catch(() => {});
}
```

#### c) Provider の value で setAirfield を差し替え

```tsx
// 変更前
setAirfield: (airfield: AirfieldConfig) => update({ airfield }),

// 変更後
setAirfield: (airfield: AirfieldConfig) => updateAirfield(airfield),
```

### 前提条件
サーバーAPI側（`webapp/src/app/api/system/route.ts`）に `airfield-save` アクションと `loadAirfieldConfig()` が既に実装されていること。FEELDSCOPE-OGN 側にこれらがない場合は FEELDSCOPE-new の `route.ts` から移植する。

---

## 2. ADS-B停止時のMQTT retainメッセージ残留

### 問題
ADS-B受信をOFFにしても、Mode-S/ADS-B機体（例: SNJ19）がマップに表示され続ける。
原因: ADS-Bポーラーが `retain=true` でMQTTに機体リストを publish しているため、ポーラー停止後もブローカーにメッセージが残留し、webapp接続時に古いデータが配信される。

### 修正方針（2つのアプローチ）

#### a) 即時対処: adsb-stop 時に retain メッセージをクリア

`webapp/src/app/api/system/route.ts` の `adsb-stop` アクション内で、ポーラー停止後に retain メッセージを削除する。

```typescript
case "adsb-stop":
  await execAsync("sudo systemctl stop adsb-poller");
  await execAsync("sudo systemctl disable adsb-poller").catch(() => {});
  await removeAdsbConfig();
  // Clear retained ADS-B MQTT messages
  await execAsync("mosquitto_pub -t 'ogn/TestJP/aircraft_adsb' -r -n").catch(() => {});
  return NextResponse.json({ ok: true, adsb: "stopped" });
```

#### b) 根本対処: adsb-poller.py で個別機体の retain もクリア

`adsb-poller.py` の終了処理（SIGTERM ハンドラ）で、追跡中の全機体の retained メッセージを空メッセージで上書きしてからクリーンに終了する。

### 手動クリア（応急処置）

```bash
mosquitto_pub -t 'ogn/TestJP/aircraft_adsb' -r -n
```

---

## 適用チェックリスト

- [x] UnitContext.tsx の初期ロード修正（サーバーからairfield取得）
- [x] UnitContext.tsx の setAirfield 修正（サーバーに保存）
- [x] route.ts に airfield-save / loadAirfieldConfig を新規実装
- [x] route.ts の adsb-stop で retain メッセージクリア追加（動的Receiver ID使用）
- [ ] ビルド & 動作確認（RPi上で実施）
