import fs from 'node:fs'
import assert from 'node:assert/strict'
import { inferControlPointDirection } from '../../src/components/map/roadControlPointDirection.ts'
import { ROAD_DIRECTION_NAMES,roadDirectionReferenceKey } from '../../src/components/map/roadDirectionNames.ts'
import { aggregateOverviewTracks } from '../../src/components/map/overviewAggregation.ts'
const snapshotPath=process.argv[2] ?? 'output/road-direction-validation/geometry-snapshot.json'
const raw=JSON.parse(fs.readFileSync(snapshotPath,'utf8'))
const records=raw.caches.filter(c=>c.roadParts?.length)
const eligible=p=>['EXPRESSWAY','NATIONAL_ROAD'].includes(p.roadClass)
const rows=[]
for(const cache of records)for(const [partIndex,p] of cache.roadParts.entries()){
 if(!eligible(p))continue
 const ref=ROAD_DIRECTION_NAMES[roadDirectionReferenceKey(p,p.routeRef??'')??'']
 const ramp=/匝道|辅路|连接线|联络线|收费站|服务区|出口|入口/.test(`${p.roadName??''} ${p.instruction??''}`)
 const result=ref&&!ramp?inferControlPointDirection(p.polyline??[],ref):null
 rows.push({segmentId:cache.segmentId,partIndex,routeRef:p.routeRef,source:p.source,roadName:p.roadName,reason:!ref?'no-reference':ramp?'ramp-or-connector':result?.intervals.length?'matched':'insufficient-anchors',km:result?.distancesKm.at(-1)??0,intervals:result?.intervals??[]})
}
fs.mkdirSync('output/road-direction-validation',{recursive:true})
fs.writeFileSync('output/road-direction-validation/part-matches.json',JSON.stringify(rows,null,2))
console.log('PART_MATCHES',JSON.stringify({parts:rows.length,matched:rows.filter(r=>r.reason==='matched').length,roads:[...new Set(rows.filter(r=>r.reason==='matched').map(r=>r.routeRef))],reasons:Object.fromEntries([...new Set(rows.map(r=>r.reason))].map(k=>[k,rows.filter(r=>r.reason===k).length]))}))
const tracks=records.map(c=>({segmentId:c.segmentId,segmentName:c.segmentId,line:c.points,points:[],roadParts:c.roadParts}))
const before=JSON.stringify(tracks)
console.time('aggregate-real-tracks');const lines=aggregateOverviewTracks(tracks);console.timeEnd('aggregate-real-tracks')
assert.equal(JSON.stringify(tracks),before,'source geometry or cached classification was mutated')
let directional=0,named=0,conflicts=0
for(const line of lines){if(!line.directions)continue;directional++;assert.equal(line.count,line.directions.forward.count+line.directions.reverse.count);if(line.directions.forward.destination)named++;if(line.directions.conflictingNames)conflicts++}
const byRoad={}
for(const line of lines){if(!line.directions)continue;const ref=line.routeRef??'?';const row=byRoad[ref]??={sections:0,named:0};row.sections++;if(line.directions.forward.destination)row.named++}
const summary={records:records.length,sourcePoints:tracks.reduce((n,t)=>n+t.line.length,0),outputSections:lines.length,directional,named,conflicts,sourceUnchanged:true,countConservation:true,byRoad}
fs.writeFileSync('output/road-direction-validation/summary.json',JSON.stringify(summary,null,2));fs.writeFileSync('output/road-direction-validation/overview-lines.json',JSON.stringify(lines));console.log('SUMMARY',JSON.stringify(summary))
