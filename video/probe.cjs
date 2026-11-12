const d=require("../data/data.json");const fs=require("fs");
console.log(d.ddragonVersion, d.generatedAt);
let H=0,G=0,L=0;
for(const p of d.players){const a=p.accounts[p.bestAccount??0];const s=a.stats;const g=a.rank.wins+a.rank.losses;const h=g*s.avgDurationMin/60;H+=h;G+=g;L+=a.rank.losses;
const vs=Object.entries(s.vs).filter(([,x])=>x[0]>=4).map(([c,[n,w]])=>({c,n,w,adj:(w+3)/(n+6)})).sort((x,y)=>x.adj-y.adj).slice(0,2);
console.log("\n##",p.name,a.riotId,JSON.stringify(a.rank),"icon",a.profileIconId,"role",s.mainRole);
console.log(" seasonGames",g,"hours",Math.round(h),"first",new Date(s.firstGameAt).toISOString().slice(0,10),"worstLoss",s.streak.worstLoss,"cur",JSON.stringify(s.streak.current),"last20",JSON.stringify(s.last20));
console.log(" nem",JSON.stringify(vs));
console.log(" worstGame",JSON.stringify(s.worstGame));
console.log(" throw",JSON.stringify(s.gold?.biggestThrow));
console.log(" worstChamp",JSON.stringify(s.worstChamp), "ornn?", JSON.stringify(s.champs.find(c=>c.key=="Ornn")));
console.log(" conduct ff",s.conduct?.ffPct,s.conduct?.ffLosses,"/",s.conduct?.losses,"q",s.conduct?.q,"pings",s.conduct?.pings,"fod",JSON.stringify(s.firstOfDay));
console.log(" lpHist", a.lpHist?.length, "kills rec", JSON.stringify(s.gameRecords?.kills));
}
console.log("\nTOTAL games",G,"hours",Math.round(H),"days",(H/24).toFixed(1),"losses",L);
