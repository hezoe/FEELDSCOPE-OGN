import sys,os,json,collections,math
ELEV=23.0; REG={"FLRDB072C":"JA4067","FLRDB0730":"JA40TW","FLRDB0733":"T2",
 "ICA84B58E":"HC","FLRDB0732":"JA03KH","FLRDB072E":"KH","FLRDB072F":"MT"}
TOW={"FLRDB072C","FLRDB0730"}
TAKEOFF=30/3.6; LANDSPD=10/3.6; ROLLSPD=50/3.6; ROLLSEC=8
AIRCONF=500*0.3048; ONGND=50
RELMIN=150; TOWDROP=50; TOWMIN=300; GAIN=100; CLACT=1.5; CLSTOP=0.0
RELWIN=6; RELDROP=5; RELAGE=1200
PW=60; PFIX=15; PH=200; PV=100; PMIN=3; PGRACE=120
WC=7.0; WMIN=5; WSTART=60; WREL=2.0; WAGE=180
MODE=sys.argv[-1]; FILES=sys.argv[1:-1]
PAIR = MODE=="new"
TOCONF_AGL=20; TOCONF_SEC=60

def hav(a,b,c,d):
    R=6371000; dla=math.radians(c-a); dlo=math.radians(d-b)
    h=math.sin(dla/2)**2+math.cos(math.radians(a))*math.cos(math.radians(c))*math.sin(dlo/2)**2
    return 2*R*math.asin(math.sqrt(h))
def hhmm(ep): 
    import time; return time.strftime("%H:%M",time.gmtime(ep+9*3600))

ev=[]
seen=set()
for f_ in FILES:
    for line in open(f_,encoding="utf-8",errors="replace"):
        if " {" not in line: continue
        t,js=line.split(" ",1)
        try: d=json.loads(js)
        except: continue
        dev=t.split("/")[3]; key=(dev,int(d["timestamp_epoch"]))
        if key in seen: continue
        seen.add(key)
        ev.append((d["timestamp_epoch"], dev, d))
ev.sort(key=lambda x:x[0])

T={}; flights=[]; DBG=[]
def st(dev):
    if dev not in T: T[dev]=dict(phase=None,fid=None,to=None,mx=0,toagl=0,wasHigh=False,
        low=None,rec=[],lastfix=None,pair=None,psamp=0,pa=None,pd=None,ps=None,
        ws=None,winch=False,pconf=False,roll=None,rollagl=0)
    return T[dev]

for now,dev,p in ev:
    tow=dev in TOW; s=st(dev)
    agl=p["altitude_m"]-ELEV; sp=p["ground_speed_ms"]; cl=p["climb_rate_ms"]
    if s["phase"] is None:
        s["phase"]="ground" if (agl<ONGND and sp<TAKEOFF) else "airborne"
        s["mx"]=agl; s["toagl"]=agl; s["wasHigh"]=agl>AIRCONF
    s["lastfix"]=dict(lat=p["latitude"],lon=p["longitude"],alt=p["altitude_m"],t=now)
    s["rec"].append((now,sp,cl)); s["rec"]=[r for r in s["rec"] if now-r[0]<=RELWIN]
    if s["phase"]=="ground":
        if PAIR:   # 新ロジック: 浮いて初めて飛行を作る
            if sp>TAKEOFF:
                if s["roll"] is None: s["roll"]=now; s["rollagl"]=agl
            else: s["roll"]=None
            if s["roll"] is not None and now-s["roll"]>TOCONF_SEC: s["roll"]=None
            if s["roll"] is not None and agl>=TOCONF_AGL:
                f=dict(to=hhmm(s["roll"]),ld=None,ra=None,dev=dev,inf=False); flights.append(f)
                s.update(phase="airborne",fid=f,to=s["roll"],mx=agl,toagl=s["rollagl"],
                         wasHigh=agl>AIRCONF,low=None,roll=None,
                         pair=None,psamp=0,pconf=False,pa=None,pd=None,ps=None,ws=None,winch=False)
        elif sp>TAKEOFF:
            f=dict(to=hhmm(now),ld=None,ra=None,dev=dev,inf=False); flights.append(f)
            s.update(phase="airborne",fid=f,to=now,mx=agl,toagl=agl,wasHigh=agl>AIRCONF,
                     low=None,pair=None,psamp=0,pconf=False,pa=None,pd=None,ps=None,ws=None,winch=False)
        continue
    s["mx"]=max(s["mx"],agl)
    if agl>AIRCONF: s["wasHigh"]=True
    if PAIR and not tow and s["phase"]=="airborne" and s["to"] is not None:
        if cl>=WC:
            if s["ws"] is None: s["ws"]=now
            if (s["ws"]-s["to"])<=WSTART and now-s["ws"]>=WMIN: s["winch"]=True
        else: s["ws"]=None
        if now-s["to"]>WAGE: s["winch"]=False
    f=s["fid"]
    if s["phase"]=="airborne" and f and agl>RELMIN and s["to"] is not None and now-s["to"]<RELAGE:
        rel=False
        if tow and agl>TOWMIN:
            if s["mx"]-agl>TOWDROP: rel=True
        elif PAIR and not tow and s["winch"]:
            if cl<=WREL: rel=True
        elif not tow and s["mx"]-s["toagl"]>=GAIN:
            mxsp=max((r[1] for r in s["rec"]),default=0)
            if cl<=CLSTOP and any(r[2]>=CLACT for r in s["rec"]) and mxsp-sp>=RELDROP: rel=True
        if rel:
            dist=hav(43.549417,141.89415,p["latitude"],p["longitude"])
            s["phase"]="released"; alt=round(s["mx"]); f["ra"]=alt
            s["winch"]=False; s["ws"]=None; s["pa"]=None; s["ps"]=None
            if PAIR and tow and s["pconf"] and s["pair"]:
                m=T.get(s["pair"])
                if m and m["phase"]=="airborne" and m["fid"]:
                    m["pa"]=alt; m["pd"]=dist; m["ps"]=now
    if PAIR:
        # ペア追跡
        if s["pconf"]: pass
        elif s["phase"]=="airborne" and s["to"] is not None and now-s["to"]<=RELAGE and cl<=WC:
            found=[]
            for o,os_ in T.items():
                if o==dev or (o in TOW)==tow: continue
                if os_["phase"]!="airborne" or os_["to"] is None: continue
                if abs(os_["to"]-s["to"])>PW: continue
                lf=os_["lastfix"]
                if not lf or now-lf["t"]>PFIX: continue
                if abs(p["altitude_m"]-lf["alt"])>PV: continue
                if hav(p["latitude"],p["longitude"],lf["lat"],lf["lon"])>PH: continue
                found.append(o)
            if len(found)!=1: s["psamp"]=0
            else:
                if s["pair"]!=found[0]: s["pair"]=found[0]; s["psamp"]=0
                s["psamp"]+=1
                if s["psamp"]>=PMIN: s["pconf"]=True
        elif cl>WC and not s["pconf"]: s["pair"]=None; s["psamp"]=0
        # 預かった値の適用
        if s["ps"] is not None and now-s["ps"]>=PGRACE:
            alt,dist=s["pa"],s["pd"]; s["pa"]=s["pd"]=s["ps"]=None
            if s["fid"] and s["fid"]["ra"] is None:
                s["fid"]["ra"]=alt; s["fid"]["inf"]=True
                if s["phase"]=="airborne": s["phase"]="released"
    # 着陸
    if agl<ONGND and sp<ROLLSPD:
        if s["low"] is None: s["low"]=now
    else: s["low"]=None
    stopped = agl<AIRCONF and sp<LANDSPD
    rolled = s["low"] is not None and now-s["low"]>=ROLLSEC
    if (s["wasHigh"] or s["to"] is not None) and (stopped or rolled):
        if s["fid"] and s["fid"]["ld"] is None: s["fid"]["ld"]=hhmm(now)
        s.update(phase="ground",fid=None,to=None,mx=agl,toagl=agl,wasHigh=False,low=None,
                 pair=None,psamp=0,pconf=False,pa=None,pd=None,ps=None,ws=None,winch=False)

n=sum(1 for f in flights if f["ra"] is not None)
print(f"{'新ロジック' if PAIR else '現行ロジック'}: {len(flights)}便中 離脱高度あり {n}便")
for f in flights:
    m=" ※推定" if f["inf"] else ""
    print(f"  {f['to']} {f['ld'] or 'FLYING':>6s} {REG.get(f['dev'],f['dev']):<9s} ra={str(f['ra']):>6s}{m}")
