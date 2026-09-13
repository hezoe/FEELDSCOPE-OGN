# -*- coding: utf-8 -*-
"""収集データから離脱検知の精度を測る。データが増えるたび回せる。"""
import sys,os,collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib_legs import *
WCM=7.0; WMINS=5; WSTART=60; WRELC=2.0; WAGE=180
TOWDROP=50; TOWMIN=300

def winch_detect(pos,dev,t0,t1):
    ws=None;w=False;mx=None
    for t in range(int(t0),int(t1)+1):
        x=pos[dev].get(t)
        if not x: continue
        agl=x["altitude_m"]-ELEV; cl=x["climb_rate_ms"]
        mx=agl if mx is None else max(mx,agl)
        if cl>=WCM:
            if ws is None: ws=t
            if ws-t0<=WSTART and t-ws>=WMINS: w=True
        else: ws=None
        if t-t0>WAGE: w=False
        if w and agl>RELMIN and cl<=WRELC: return t,round(mx)
    return None,None

def tow_detect(pos,dev,t0,t1):
    mx=None
    for t in range(int(t0),int(t1)+1):
        x=pos[dev].get(t)
        if not x: continue
        agl=x["altitude_m"]-ELEV
        mx=agl if mx is None else max(mx,agl)
        if agl>TOWMIN and mx-agl>TOWDROP: return t,round(mx)
    return None,None

pos=load(sys.argv[1:]); L=legs_of(pos); T=truth(pos,L)
print(f"データ: {sum(len(m) for m in pos.values())}点 / {len(pos)}機 / 飛行{sum(len(v) for v in L.values())}区間")
print(f"確度の高い真値: {len(T)}件 (曳航{sum(1 for r in T if r[4]=='曳航')} ウィンチ{sum(1 for r in T if r[4]=='ウィンチ')})\n")

print("=== ウィンチ発航の検知精度 ===")
n=0
for dev,t0,t1,rel,k,m in sorted(T,key=lambda r:r[1]):
    if k!="ウィンチ": continue
    ta=pos[dev][rel]["altitude_m"]-ELEV
    at,aa=winch_detect(pos,dev,t0,t1)
    n+=1
    if at is None: print(f"  {REG.get(dev,dev):7s} 離陸{jst(t0)} 真{ta:5.0f}m -> 検知できず")
    else: print(f"  {REG.get(dev,dev):7s} 離陸{jst(t0)} 真{ta:5.0f}m -> {aa:5d}m  誤差{aa-ta:+4.0f}m  遅れ{at-rel:+3d}s")
if not n: print("  該当なし")

print("\n=== 曳航ペアからの補完精度（曳航機の記録値 vs グライダーの真の離脱高度）===")
n=0
for dev,t0,t1,rel,k,mate in sorted(T,key=lambda r:r[1]):
    if k!="曳航" or not mate: continue
    ta=pos[dev][rel]["altitude_m"]-ELEV
    # 曳航機の該当区間
    leg=[(a,b) for a,b in L.get(mate,[]) if a<=rel<=b]
    if not leg: print(f"  {REG.get(dev,dev):7s} 曳航機の区間が取れず"); continue
    at,aa=tow_detect(pos,mate,*leg[0]); n+=1
    if at is None: print(f"  {REG.get(dev,dev):7s} 真{ta:5.0f}m -> 曳航機側も検知できず")
    else: print(f"  {REG.get(dev,dev):7s} 離陸{jst(t0)} 真{ta:5.0f}m -> 曳航機{aa:5d}m  誤差{aa-ta:+4.0f}m  遅れ{at-rel:+3d}s")
if not n: print("  該当なし")

print("\n=== 受信品質（飛行中の10秒以上の欠落）===")
for dev,m in sorted(pos.items()):
    ts=sorted(m); g=[(a,b-a) for a,b in zip(ts,ts[1:]) if b-a>=10 and m[a]["altitude_m"]-ELEV>100]
    if g: print(f"  {REG.get(dev,dev):7s} {len(g):3d}回 最長{max(x[1] for x in g):4d}秒 合計{sum(x[1] for x in g):5d}秒")
