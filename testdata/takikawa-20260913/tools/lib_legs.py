import json,collections,math,time
ELEV=23.0
# 機体DBは運用中に更新される。固定で持たず、保存した実物から読む。
import os as _os
# 機体DBは受信機から取ってきて、このスクリプトの1つ上に置く:
#   curl http://<受信機>/api/aircraft-db > aircraft-db.json
_DB=_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),"..","aircraft-db.json")
TOW=set(); REG={}
try:
    import json as _j
    _d=_j.load(open(_DB,encoding="utf-8")); _d=_d.get("aircraft",_d)
    for _k,_v in _d.items():
        if _v.get("aircraft_type")=="tow": TOW.add(_k)
        _n=_v.get("registration") or _v.get("competition_id")
        if _n: REG[_k]=_n
except Exception as _e:
    print("機体DBを読めません:",_e)
    print("  受信機から取得してください:")
    print("    curl http://<受信機>/api/aircraft-db > testdata/<日付>/aircraft-db.json")
TAKEOFF=30/3.6; ONGND=50; LANDSPD=10/3.6; ROLLSPD=50/3.6; ROLLSEC=8; AIRCONF=152.4
WC=7.0; WREL=2.0; RELMIN=150; WMIN_SEC=5
def hav(a,b,c,d):
    R=6371000; dla=math.radians(c-a); dlo=math.radians(d-b)
    h=math.sin(dla/2)**2+math.cos(math.radians(a))*math.cos(math.radians(c))*math.sin(dlo/2)**2
    return 2*R*math.asin(math.sqrt(h))
def jst(t): return time.strftime("%H:%M:%S",time.gmtime(t+9*3600))
def load(files):
    pos=collections.defaultdict(dict)
    for f in files:
        for line in open(f,encoding="utf-8",errors="replace"):
            if " {" not in line: continue
            t,js=line.split(" ",1)
            try: d=json.loads(js)
            except: continue
            pos[t.split("/")[3]][int(d["timestamp_epoch"])]=d
    return pos
def legs_of(pos):
    legs=collections.defaultdict(list)
    for dev,m in pos.items():
        p=None; to=None; low=None; hi=False
        for t in sorted(m):
            x=m[t]; agl=x["altitude_m"]-ELEV; sp=x["ground_speed_ms"]
            if p is None: p="ground" if (agl<ONGND and sp<TAKEOFF) else "airborne"
            if p=="ground":
                if sp>TAKEOFF: p="airborne"; to=t; low=None; hi=False
                continue
            if agl>AIRCONF: hi=True
            low = t if (agl<ONGND and sp<ROLLSPD and low is None) else (None if not(agl<ONGND and sp<ROLLSPD) else low)
            if (hi or to) and ((agl<AIRCONF and sp<LANDSPD) or (low and t-low>=ROLLSEC)):
                if to: legs[dev].append((to,t))
                p="ground"; to=None; low=None; hi=False
        if to: legs[dev].append((to,max(m)))
    return legs
def truth(pos,legs):
    """(dev, t0, t1, 真の離脱時刻, 種別, 相手) を返す"""
    out=[]
    for dev,ls in legs.items():
        if dev in TOW: continue
        for t0,t1 in ls:
            r=None;k=None;mate=None
            for tw in TOW:
                if tw not in pos: continue
                ts=[t for t in range(int(t0),int(t1)+1) if t in pos[tw] and t in pos[dev]
                    and pos[dev][t]["altitude_m"]-ELEV>RELMIN]
                cl=[t for t in ts if hav(pos[tw][t]["latitude"],pos[tw][t]["longitude"],
                                         pos[dev][t]["latitude"],pos[dev][t]["longitude"])<=100]
                if len(cl)<30: continue
                # 索が外れた点 = 最後に近接した点。ただし「曳航機の受信が
                # 途切れただけ」を離脱と読まないよう、そのあとも相手を受信し
                # 続けていて、距離が確かに開いたことを確かめる。
                cand=cl[-1]
                after=[t for t in ts if cand<t<=cand+180]
                if len(after)<30: continue
                # 離脱の前後で受信が途切れていないこと。途切れた場合、
                # 「最後に近接した点」は索が外れた点ではなく受信が切れた点に
                # なる。実測では 90 秒の欠落の前後で 471m -> 663m と開いた。
                if min(after)-cand>20: continue
                gaps=[b-a for a,b in zip(after,after[1:])]
                if gaps and max(gaps)>20: continue
                # 300m 超に開いた点が十分あれば、受信欠落ではなく本当に離れた
                far=[t for t in after if hav(pos[tw][t]["latitude"],pos[tw][t]["longitude"],
                                             pos[dev][t]["latitude"],pos[dev][t]["longitude"])>300]
                if len(far)<25: continue
                r=cand;k="曳航";mate=tw;break
            if r is None:
                # ウィンチ: 離陸直後の急上昇が続き、そのあと最初に上昇が
                # 止まった点。崩れ方は機体と索の緩め方で変わるので、
                # 急上昇の最後から 30 秒の幅で探す。
                steep=[t for t in range(int(t0),int(t0)+181)
                       if t in pos[dev] and pos[dev][t]["climb_rate_ms"]>=WC]
                if len(steep)>=WMIN_SEC:
                    last=steep[-1]
                    for t in range(last,last+31):
                        x=pos[dev].get(t)
                        if x and x["climb_rate_ms"]<=WREL:
                            r=t;k="ウィンチ";break
            if r: out.append((dev,t0,t1,r,k,mate))
    return out
