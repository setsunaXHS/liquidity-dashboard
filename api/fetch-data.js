// Vercel Serverless Function - 预算所有 FRED 数据 + 历史评分
// 供 OpenClaw Cron 调用，返回完整 data.json 内容
const https = require('https');
const zlib  = require('zlib');

const FRED_API_KEY = process.env.FRED_API_KEY || 'cd80bce065d6d311df574fbe558929f6';
const FRED_BASE    = 'https://api.stlouisfed.org/fred/series/observations';
const TIMEOUT_MS   = 25000;

async function fredFetch(seriesId, params = {}) {
  const q = new URLSearchParams({
    series_id: seriesId, api_key: FRED_API_KEY, file_type: 'json', sort_order: 'asc', ...params,
  });
  const url = `${FRED_BASE}?${q}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept-Encoding': 'gzip, deflate', 'User-Agent': 'liquidity-dashboard/3.0' } }, (r) => {
      let stream = r;
      const enc = r.headers['content-encoding'] || '';
      if (enc.includes('gzip'))    stream = r.pipe(zlib.createGunzip());
      if (enc.includes('deflate')) stream = r.pipe(zlib.createInflate());
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch(e) { reject(e); } });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error(`Timeout: ${seriesId}`)); });
  });
}

function parseMap(d, divisor = 1) {
  const out = {};
  for (const o of (d.observations || [])) { if (o.value !== '.') out[o.date] = parseFloat(o.value) / divisor; }
  return out;
}

function nearest(map, date, maxDays = 7) {
  const keys = Object.keys(map).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i] <= date) { const diff = (new Date(date) - new Date(keys[i])) / 86400000; if (diff <= maxDays) return map[keys[i]]; break; }
  }
  return undefined;
}
function slope4w(series) {
  if (series.length < 5) return 0;
  const recent = series.slice(-4), older = series.slice(-8, -4);
  if (older.length < 4) return 0;
  return recent.reduce((a,b)=>a+b,0)/recent.length - older.reduce((a,b)=>a+b,0)/older.length;
}
function percentileRank(series, val) {
  if (!series || series.length < 2) return 50;
  return series.filter(v => v < val).length / series.length * 100;
}
function scoreTGA(m) {
  const d=Object.keys(m).sort(),v=d.map(x=>m[x]),c=v[v.length-1],t=slope4w(v);
  if(c<0.3)return 1;if(c<0.6&&t<=0)return 2;if(c<1.0&&Math.abs(t)<0.02)return 3;
  if(c<1.0&&t>0.02)return 4;if(c>=1.0&&t>0)return 5;if(c>=1.0)return 4;return 3;
}
function scoreRRP(m) {
  const d=Object.keys(m).sort(),v=d.map(x=>m[x]),c=v[v.length-1],t=slope4w(v);
  if(c>1.0&&t>=0)return 1;if(c>1.0&&t<0)return 2;if(c>=0.3&&t<0)return 3;if(c<0.3&&c>=0.05)return 4;return 5;
}
function scoreReserves(resMap, walclMap) {
  const rd=Object.keys(resMap).sort(),c=resMap[rd[rd.length-1]];
  const wd=Object.keys(walclMap).sort(),w=walclMap[wd[wd.length-1]];
  const ratio=w?c/w:0.45;
  const a=c>3.5?1:c>3.2?2:c>3.0?3:c>2.7?4:5;
  const r=ratio>0.52?1:ratio>0.48?2:ratio>0.44?3:ratio>0.40?4:5;
  return Math.max(a,r);
}
function scoreNetLiquidity(walclMap, tgaMap, rrpMap) {
  const dates=Object.keys(walclMap).sort();
  const nl=dates.map(d=>{const W=walclMap[d],T=tgaMap[d]??nearest(tgaMap,d),R=rrpMap[d]??nearest(rrpMap,d)??0;return(W&&T)?W-T-R:null;}).filter(v=>v!==null);
  if(nl.length<10)return 3;
  const w2=nl.slice(-104),c=nl[nl.length-1],pct=percentileRank(w2,c);
  const mom=nl.length>=13?nl[nl.length-1]-nl[nl.length-13]:0;
  if(pct>75)return 1;if(pct>50&&mom>=0)return 2;if(pct>50&&mom<0)return 3;if(pct>25)return mom<0?4:3;return 5;
}
function _eiAbs(bp){return bp<=-7?1:bp<=-5?2:bp<=-2?3:bp<=3?4:5;}
function _eiTrend(sp,i){if(i<5)return 3;const a5=sp.slice(i-4,i+1).reduce((a,b)=>a+b,0)/5,n=Math.min(i+1,20),a20=sp.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n,d=a5-a20;return d<-0.5?1:d<-0.2?2:d<0.2?3:d<0.8?4:5;}
function scoreEFFR_IORB(effrMap,iorbMap){
  const d=Object.keys(effrMap).sort(),sp=d.map(x=>{const e=effrMap[x],i=iorbMap[x]??nearest(iorbMap,x,5);return(e!=null&&i!=null)?(e-i)*100:null;}).filter(v=>v!==null);
  if(!sp.length)return 3;const i=sp.length-1,a5=sp.slice(Math.max(0,i-4),i+1).reduce((a,b)=>a+b,0)/Math.min(5,sp.length);
  return Math.round(_eiAbs(sp[i])*0.40+_eiAbs(a5)*0.35+_eiTrend(sp,i)*0.25);
}
function _seAbs(bp){return bp<=0?1:bp<=3?2:bp<=8?3:bp<=15?4:5;}
function _seTrend(sp,i){if(i<5)return 3;const a5=sp.slice(i-4,i+1).reduce((a,b)=>a+b,0)/5,n=Math.min(i+1,20),a20=sp.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n,d=a5-a20;return d<-0.5?1:d<-0.2?2:d<0.2?3:d<0.8?4:5;}
function scoreSOFR_EFFR(sofrMap,effrMap){
  const d=Object.keys(sofrMap).sort(),sp=d.map(x=>{const s=sofrMap[x],e=effrMap[x]??nearest(effrMap,x,5);return(s!=null&&e!=null)?(s-e)*100:null;}).filter(v=>v!==null);
  if(!sp.length)return 3;const i=sp.length-1,a5=sp.slice(Math.max(0,i-4),i+1).reduce((a,b)=>a+b,0)/Math.min(5,sp.length);
  return Math.round(_seAbs(sp[i])*0.40+_seAbs(a5)*0.35+_seTrend(sp,i)*0.25);
}
function compositeScore(s){return Math.round((s.res*0.35+s.nl*0.30+s.tga*0.25+s.rrp*0.10)*10)/10;}

function buildRadarHistory(walcl,tga,rrp,res,effr,iorb,sofr){
  const allDates=Object.keys(walcl).sort();
  const efKeys=Object.keys(effr).sort(),ioKeys=Object.keys(iorb).sort(),soKeys=Object.keys(sofr).sort();
  const wS={},tS={},rS={},rsS={},efS={},ioS={},soS={};
  let efPtr=0,ioPtr=0,soPtr=0;
  return allDates.map((d)=>{
    if(walcl[d]!=null)wS[d]=walcl[d];if(tga[d]!=null)tS[d]=tga[d];if(rrp[d]!=null)rS[d]=rrp[d];if(res[d]!=null)rsS[d]=res[d];
    while(efPtr<efKeys.length&&efKeys[efPtr]<=d){efS[efKeys[efPtr]]=effr[efKeys[efPtr]];efPtr++;}
    while(ioPtr<ioKeys.length&&ioKeys[ioPtr]<=d){ioS[ioKeys[ioPtr]]=iorb[ioKeys[ioPtr]];ioPtr++;}
    while(soPtr<soKeys.length&&soKeys[soPtr]<=d){soS[soKeys[soPtr]]=sofr[soKeys[soPtr]];soPtr++;}
    const sTGA=scoreTGA(tS),sRRP=scoreRRP(rS),sRes=scoreReserves(rsS,wS),sNL=scoreNetLiquidity(wS,tS,rS);
    const sEI=efPtr>0&&ioPtr>0?scoreEFFR_IORB(efS,ioS):3,sSE=soPtr>0&&efPtr>0?scoreSOFR_EFFR(soS,efS):3;
    const comp=compositeScore({tga:sTGA,rrp:sRRP,res:sRes,nl:sNL});
    return{date:d,tga:sTGA,rrp:sRRP,res:sRes,nl:sNL,effrIorb:sEI,sofrEffr:sSE,composite:comp};
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  try {
    const OBS_START = '2015-01-01', RATE_START = '2019-01-01';
    const [dWALCL,dWRESBAL,dWCURRNS,dWDTGAL,dRRPON,dUPPER,dLOWER,dEFFR,dIORB,dSOFR] = await Promise.all([
      fredFetch('WALCL',{observation_start:OBS_START}),
      fredFetch('WRESBAL',{observation_start:OBS_START}),
      fredFetch('WCURRNS',{observation_start:OBS_START}),
      fredFetch('WDTGAL',{observation_start:OBS_START}),
      fredFetch('RRPONTSYD',{observation_start:OBS_START}),
      fredFetch('DFEDTARU',{observation_start:RATE_START}),
      fredFetch('DFEDTARL',{observation_start:RATE_START}),
      fredFetch('EFFR',{observation_start:RATE_START}),
      fredFetch('IORB',{observation_start:RATE_START}),
      fredFetch('SOFR',{observation_start:RATE_START}),
    ]);
    const walcl=parseMap(dWALCL,1e6),wres=parseMap(dWRESBAL,1e6),curr=parseMap(dWCURRNS,1e3);
    const tga=parseMap(dWDTGAL,1e6),rrp=parseMap(dRRPON,1e3);
    const upper=parseMap(dUPPER),lower=parseMap(dLOWER),effr=parseMap(dEFFR),iorb=parseMap(dIORB),sofr=parseMap(dSOFR);
    const radarHistory=buildRadarHistory(walcl,tga,rrp,wres,effr,iorb,sofr);
    const payload={fetchedAt:new Date().toISOString(),series:{walcl,wres,curr,tga,rrp,upper,lower,effr,iorb,sofr},radarHistory};
    res.setHeader('Content-Type','application/json');
    res.status(200).json(payload);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
};
