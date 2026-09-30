import test from 'node:test'
import assert from 'node:assert/strict'
import { inferControlPointDirection } from '../src/components/map/roadControlPointDirection.ts'
import { roadDirectionReferenceKey } from '../src/components/map/roadDirectionNames.ts'
import { ROAD_DIRECTION_REFERENCES } from '../src/components/map/roadDirectionReference.ts'
import { aggregateOverviewTracks } from '../src/components/map/overviewAggregation.ts'
const reference={name:'测试道路',aliases:[],endpoints:['起点','终点'],unlocatedControls:[],source:'test',controls:[['甲',0,0,7,0],['乙',0,1,7,1]]}
const dense=points=>points.flatMap((p,i)=>!i?[p]:Array.from({length:100},(_,j)=>{const a=points[i-1],t=(j+1)/100;return [a[0]+(p[0]-a[0])*t,a[1]+(p[1]-a[1])*t]}))

test('ordered towns determine direction without navigation words, including a local backward bend',()=>{
 const result=inferControlPointDirection(dense([[0,0],[0,.4],[.1,.35],[.1,.7],[0,1]]),reference)
 assert.equal(result.intervals.length,1);assert.equal(result.intervals[0].sign,1)
 assert.deepEqual(result.intervals[0].anchors,['甲','乙'])
 const reverse=inferControlPointDirection(dense([[0,1],[.1,.7],[.1,.35],[0,.4],[0,0]]),reference)
 assert.equal(reverse.intervals[0].sign,-1)
})

test('out-and-back passages change destination; unobserved turns and isolated snippets stay unknown',()=>{
 const result=inferControlPointDirection(dense([[0,0],[0,1],[0,0]]),reference)
 assert.deepEqual(result.intervals.map(x=>x.sign),[1,-1])
 assert.equal(inferControlPointDirection(dense([[0,0],[0,.4],[0,0]]),reference).intervals.length,0)
 assert.equal(inferControlPointDirection(dense([[0,.4],[0,.6]]),reference).intervals.length,0)
})

test('invalid points, sparse jumps and overlapping administrative centres cannot create anchors',()=>{
 assert.equal(inferControlPointDirection([[0,0],[0,1]],reference).intervals.length,0)
 const points=dense([[0,0],[0,1]]);points[50]=[NaN,NaN]
 assert.equal(inferControlPointDirection(points,reference).intervals.length,0)
 assert.equal(inferControlPointDirection(dense([[0,0],[0,.01]]),{...reference,controls:[['甲',0,0,7,0],['乙',0,.01,7,1]]}).intervals.length,0)
})

test('geographic inference remains bounded by visited anchors rather than extending across the whole polyline',()=>{
 const r=inferControlPointDirection(dense([[0,-.5],[0,0],[0,1],[0,1.5]]),reference)
 assert.ok(r.intervals[0].fromKm>50)
 assert.ok(r.intervals[0].toKm<r.distancesKm.at(-1)-50)
})

test('regional references require provincial or road-name context; rings have no endpoint pair',()=>{
 assert.equal(roadDirectionReferenceKey({roadClass:'EXPRESSWAY'},'S12'),undefined)
 assert.equal(roadDirectionReferenceKey({roadClass:'EXPRESSWAY',provinceCode:'610000'},'S12'),'610000:S12')
 assert.equal(roadDirectionReferenceKey({roadClass:'EXPRESSWAY',provinceCode:'440000',roadName:'榆佳高速'},'S12'),undefined)
 assert.equal(roadDirectionReferenceKey({roadClass:'EXPRESSWAY',roadName:'榆佳高速入口'},'S12'),'610000:S12')
 assert.equal(ROAD_DIRECTION_REFERENCES.G3002,undefined)
 assert.ok(Object.keys(ROAD_DIRECTION_REFERENCES).length>=70)
 for(const r of Object.values(ROAD_DIRECTION_REFERENCES))assert.ok(r.controls.every((c,i)=>!i||c[4]>r.controls[i-1][4]))
})

test('connected analysis fragments combine their town anchors while source data and per-direction totals remain intact',()=>{
 const ref=ROAD_DIRECTION_REFERENCES.G210
 const a=ref.controls.find(p=>p[0]==='石泉'),b=ref.controls.find(p=>p[0]==='西乡')
 const positions=dense([[a[1],a[2]],[b[1],b[2]]])
 const mid=50
 const make=(id,p)=>({segmentId:id,segmentName:id,line:p.map(([lat,lon])=>({lat,lon})),points:[],roadParts:[{roadClass:'NATIONAL_ROAD',routeRef:'G210',source:'MANUAL',confidence:'HIGH',distanceMeters:1,polyline:p}]})
 const tracks=[make('a',positions.slice(0,mid+1)),make('b',positions.slice(mid)),make('c',[...positions].reverse())]
 const before=structuredClone(tracks),lines=aggregateOverviewTracks(tracks)
 assert.ok(lines.some(l=>l.directions?.forward.destination))
 for(const l of lines){if(!l.directions)continue;assert.equal(l.count,l.directions.forward.count+l.directions.reverse.count)
  if(l.directions.forward.destination){const east=l.positions.at(-1)[1]>l.positions[0][1];assert.equal(l.directions.forward.destination,east?'满都拉':'防城港')}
 }
 assert.deepEqual(tracks,before)
})
