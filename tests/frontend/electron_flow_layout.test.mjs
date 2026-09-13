import assert from 'node:assert/strict';
import test from 'node:test';
import { bounds, fitScene, layoutMolecules, makeCurves, sitePorts, atomKey, refKey } from '../../src/frontend/src/electronFlowLayout.ts';
const ref = (molecule_id, atom_id) => ({molecule_id, atom_id});
const site = (...atoms) => ({atoms,pair_count:1});
const atom = (id,symbol,x,y) => ({id,symbol,x,y,formalCharge:0});
const c1=ref('alkene','c1'), c2=ref('alkene','c2'), h=ref('acid','h'), br=ref('acid','br');
const source=site(c1,c2), acidSource=site(h,br), newBond=site(c1,h), brSink=site(br);
const flow={status:'complete',sources:[source,acidSource],sinks:[newBond,brSink],flows:[{source,sink:newBond,pair_count:1},{source:acidSource,sink:brSink,pair_count:1}],remaining:{sources:[],sinks:[]},candidates:[],reason:null};
const molecules=[{id:'alkene',atoms:[atom('c1','C',0,0),atom('c2','C',1,0),atom('h1','H',-1,0),atom('h2','H',0,-1),atom('h3','H',1,-1),atom('h4','H',2,0)],bonds:[{from:'c1',to:'c2',order:2},{from:'c1',to:'h1',order:1},{from:'c1',to:'h2',order:1},{from:'c2',to:'h3',order:1},{from:'c2',to:'h4',order:1}]},{id:'acid',atoms:[atom('h','H',0,0),atom('br','Br',1,0)],bonds:[{from:'h',to:'br',order:1}]}];
test('HBr placement preserves cardinal existing bonds, aligns new contact, and separates structures',()=>{
 const placed=layoutMolecules(molecules,flow); assert.deepEqual(placed,layoutMolecules(molecules,flow));
 const atoms=new Map(placed.flatMap(p=>p.atoms.map(a=>[atomKey(a),a])));
 for(const p of placed) for(const b of p.molecule.bonds){const a=atoms.get(refKey(ref(p.molecule.id,b.from))),z=atoms.get(refKey(ref(p.molecule.id,b.to)));assert.ok(a.x===z.x||a.y===z.y);}
 const a=atoms.get(refKey(c1)),b=atoms.get(refKey(h)); assert.ok(a.x===b.x||a.y===b.y);
 for(const a of placed[0].atoms)for(const b of placed[1].atoms)assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=65);
 const curves=makeCurves(flow,atoms,placed); assert.equal(curves.length,2);
 for(const c of curves)for(const [port,control]of[[c.source,c.c1],[c.sink,c.c2]])assert.ok(Math.abs((control.x-port.x)*port.normal.y-(control.y-port.y)*port.normal.x)<1e-8);
 assert.equal(makeCurves({...flow,status:'conflict'},atoms,placed).length,0);
});
test('bounds and centering are translation invariant, oversized scene preserves all edges',()=>{
 const points=[{x:100,y:200},{x:1200,y:850}];assert.deepEqual(bounds(points),{minX:100,minY:200,maxX:1200,maxY:850});
 const fit=fitScene(points,800,430),shift={x:-1800,y:2300},translated=fitScene(points.map(p=>({x:p.x+shift.x,y:p.y+shift.y})),800,430);
 assert.equal(fit.width,translated.width);assert.equal(fit.height,translated.height);assert.equal(fit.x,translated.x+shift.x);assert.equal(fit.y,translated.y+shift.y);
 assert.ok(fit.width>800&&fit.height>430);for(const p of points){assert.ok(p.x+fit.x>=48&&p.x+fit.x<=fit.width-48);assert.ok(p.y+fit.y>=48&&p.y+fit.y<=fit.height-48);}
});
test('diagonal existing bonds fail clearly; diagonal target bond ports remain perpendicular',()=>{
 assert.throws(()=>layoutMolecules([{id:'m',atoms:[atom('a','C',0,0),atom('b','C',1,1)],bonds:[{from:'a',to:'b',order:1}]}],flow),/horizontal or vertical/);
 const atoms=new Map([[refKey(c1),{...atom('c1','C',0,0),moleculeId:'alkene'}],[refKey(h),{...atom('h','H',80,80),moleculeId:'acid'}]]);
 for(const port of sitePorts(newBond,atoms))assert.ok(Math.abs(port.normal.x*80+port.normal.y*80)<1e-8);
});
test('free-pair ports avoid existing bonds and ambiguous results draw only supplied forced flows',()=>{
 const placed=layoutMolecules(molecules,flow), atoms=new Map(placed.flatMap(p=>p.atoms.map(a=>[atomKey(a),a])));
 const bromine=atoms.get(refKey(br)),hydrogen=atoms.get(refKey(h));
 const ports=sitePorts(brSink,atoms,placed);
 assert.ok(ports.length<4);
 for(const p of ports)assert.ok((hydrogen.x-bromine.x)*p.normal.x+(hydrogen.y-bromine.y)*p.normal.y<=0);
 const partial={...flow,status:'ambiguous',flows:[flow.flows[0]],remaining:{sources:[acidSource],sinks:[brSink]},candidates:[[0,0]]};
 assert.equal(makeCurves(partial,atoms,placed).length,1);
});
test('multi-pair movements produce individual standard arrows with distinct geometry',()=>{
 const placed=layoutMolecules(molecules,flow), atoms=new Map(placed.flatMap(p=>p.atoms.map(a=>[atomKey(a),a])));
 const multiple={...flow,flows:[{...flow.flows[0],pair_count:2}]};
 const curves=makeCurves(multiple,atoms,placed);
 assert.equal(curves.length,2);assert.ok(curves.every(c=>c.flow.pair_count===1));
 assert.notDeepEqual([curves[0].source,curves[0].sink,curves[0].c1,curves[0].c2],[curves[1].source,curves[1].sink,curves[1].c1,curves[1].c2]);
});
test('incoming lone-pair donor is placed at a free face, never through a bonded hydrogen',()=>{
 const carbon=ref('cation','c'), bromine=ref('bromide','br'), source=site(bromine),sink=site(carbon,bromine);
 const data={...flow,sources:[source],sinks:[sink],flows:[{source,sink,pair_count:1}]};
 const input=[{id:'cation',atoms:[atom('c','C',0,0),atom('h1','H',0,-1),atom('h2','H',-1,0),atom('h3','H',1,0)],bonds:[{from:'c',to:'h1',order:1},{from:'c',to:'h2',order:1},{from:'c',to:'h3',order:1}]},{id:'bromide',atoms:[atom('br','Br',0,0)],bonds:[]}];
 const placed=layoutMolecules(input,data), atoms=new Map(placed.flatMap(p=>p.atoms.map(a=>[atomKey(a),a]))),c=atoms.get(refKey(carbon)),br=atoms.get(refKey(bromine));
 assert.equal(br.x,c.x);assert.ok(br.y>c.y,'Br should approach the unoccupied bottom face');
 const [curve]=makeCurves(data,atoms,placed);assert.equal(curve.source.normal.y,0,'Donor arrow should leave to a side, away from the new bond');
});
