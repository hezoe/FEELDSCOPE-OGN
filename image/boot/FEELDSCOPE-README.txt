FEELDSCOPE 受信機 SD カード — はじめにお読みください
====================================================

1. このフォルダにある「OGN-receiver.conf」をメモ帳などで開き、次を書き込んで上書き保存します。
     ReceiverName   受信機名（英字と数字だけ・3〜9文字。例: Sekiyado1）
     Latitude       緯度（例: 36.0123）
     Longitude      経度（例: 139.8456）
     piUserPassword SSH のパスワード（英字と数字だけ）
     wifiName / wifiPassword   Wi-Fi でつなぐ場合だけ（有線 LAN なら空欄）

2. SD カードを Raspberry Pi に挿し、SDR ドングル（アンテナ付き）と LAN ケーブル（または Wi-Fi）をつないで電源を入れます。

3. 30〜40分ほどで自動的にインストールが終わります。途中で2回ほど自動で再起動します。電源は切らないでください。
   同じネットワークのパソコンやスマホのブラウザで次を開くと、進み具合が見られます。
     http://ogn-receiver.local/   （開けない場合は、ルーターの管理画面で受信機の IP アドレスを調べて http://IPアドレス/）
   完了すると同じアドレスで FEELDSCOPE が開きます。管理者の初期パスワードは admin です（すぐに変更してください）。

あとから受信機名・座標・標高を変えるとき（FEELDSCOPE v1.4.27 以降）
- FEELDSCOPE の設定画面「OGN設定」で変更するか、この「OGN-receiver.conf」を書き換えて電源を入れ直してください。
  どちらでも受信機に反映されます（設定画面で保存すると OGN-receiver.conf も同じ値に書き換わります）。
- 座標は Google マップの座標（例: 36.0123, 139.8456 の前が緯度・後ろが経度）をそのまま書けます。

うまくいかないとき
- インストールの記録が、この SD カードの「feeldscope-firstboot.log」に残ります（パソコンに挿すと読めます）。
- 電源を入れ直すと、止まったところから再開します。
- 詳しい手順: https://ezoe.net/glider/FEELDSCOPE-setup-guide.html
