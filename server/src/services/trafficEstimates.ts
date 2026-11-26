import { readFileSync } from 'node:fs';
const workbook = JSON.parse(readFileSync(new URL('../data/traffic-estimates.json', import.meta.url), 'utf8')) as { basis: string; groups: Record<string, { id: string; scores: (number | null)[] }[]> };
// Provisional landmark zones, not surveyed route endpoints. Workbook R IDs are not OSM IDs.
const zones: [string, number, number][] = [
 ['R01',-5.10545,33.5401], ['R02',-5.1043,33.5413], ['R03',-5.10565,33.5396],
 ['R04',-5.10725,33.5398], ['R05',-5.1069,33.5395], ['R06',-5.10615,33.53915],
 ['R07',-5.1059,33.53945], ['R08',-5.106,33.5390], ['R09',-5.1064,33.53915],
 ['R10',-5.10626,33.53912], ['R11',-5.1067,33.5384], ['R12',-5.1084,33.5407],
 ['R13',-5.1041,33.5372], ['R14',-5.1076,33.5388],
];
export function trafficEstimate(coord: number[], weekday: number, hour: number) {
 const group=weekday===0||weekday===2?'MW':weekday===1||weekday===3?'TR':weekday===4?'F':'SS';
 const nearest=zones.map(([id,x,y])=>({id,d:Math.hypot((coord[0]-x)*92700,(coord[1]-y)*111320)})).sort((a,b)=>a.d-b.d)[0];
 if(nearest.d>180)return null;
 const row=workbook.groups[group].find(r=>r.id===nearest.id);const score=row?.scores[hour];
 return score==null?null:{load:score/5,score,estimate_id:nearest.id,mapping:'approximate landmark zone'};
}
export const trafficBasis=workbook.basis;
