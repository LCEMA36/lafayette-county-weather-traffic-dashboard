import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('const WAZE_CONFIG='), html.indexOf('/* ── Stat tiles ── */'));
function harness(respond) {
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, {textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){}}});
    return els.get(id);
  };
  const c = vm.createContext({console,Date,Number,Array,Set,Map,AbortController,setTimeout,clearTimeout,
    fetch:respond,document:{getElementById:el},
    renderWazeStats(){},renderWazeAlerts(){},renderWazeJams(){},wzDrawMap(){},
    buildTicker(){},renderOverview(){},wzAlertLayer:null,wzJamLayer:null});
  vm.runInContext(source, c);
  return {els,c,run: code => vm.runInContext(code,c)};
}

test('fresh empty feed is connected, failure clears old traffic counts and map labels', async () => {
  let fail = false;
  const h=harness(async () => {
    if(fail)throw new Error('network failure');
    return {ok:true,json:async()=>({alerts:[],jams:[],meta:{sourceUpdatedAt:new Date().toISOString()}})};
  });
  await h.run('loadWaze()');
  assert.equal(h.run('wazeIsFresh()'),true);
  assert.equal(h.els.get('waze-live-t').textContent,'Connected');
  fail=true;
  await h.run('loadWaze()');
  assert.equal(h.run('wazeIsFresh()'),false);
  assert.equal(h.els.get('waze-live-t').textContent,'Unavailable');
  assert.match(h.els.get('waze-alerts').innerHTML,/Incident and hazard data unavailable/);
  assert.match(h.els.get('waze-jams').innerHTML,/cannot be confirmed/);
  assert.equal(h.els.get('waze-alert-ct').textContent,'');
  assert.equal(h.els.get('waze-jam-ct').textContent,'');
});

test('stale, undated and malformed data are unavailable, not all-clear', async () => {
  for(const data of [{alerts:[],jams:[]},
    {alerts:[],jams:[],endTime:new Date(Date.now()-660000).toISOString()},
    {alerts:[],jams:'invalid',endTime:new Date().toISOString()}]) {
    const h=harness(async()=>({ok:true,json:async()=>data}));
    await h.run('loadWaze()');
    assert.equal(h.run('wazeState.phase'),'unavailable');
    assert.equal(h.run('wazeIsFresh()'),false);
  }
});

test('overlapping refreshes share the in-flight request guard', async () => {
  let resolve, calls=0;
  const h=harness(()=>{calls++;return new Promise(r=>{resolve=r;});});
  const first=h.run('loadWaze()');
  await h.run('loadWaze()');
  assert.equal(calls,1);
  resolve({ok:true,json:async()=>({alerts:[],jams:[],endTime:new Date().toISOString()})});
  await first;
  assert.equal(h.run('wazeBusy'),false);
});

test('success becomes unavailable once the source expires', async () => {
  const h=harness(async()=>({ok:true,json:async()=>({alerts:[],jams:[],endTime:new Date().toISOString()})}));
  await h.run('loadWaze()');
  h.run('wazeState.sourceUpdatedAt=Date.now()-660000');
  assert.equal(h.run('wazeIsFresh()'),false);
});
