// GRBL protocol, streaming, and the virtual controller, end to end.
'use strict';
module.exports = async function (t) {
  const { IP, ok, near } = t;
  const G = IP.grbl;

  console.log('Parsing replies');
  ok(G.parse('ok').type === 'ok', 'ok');
  const e = G.parse('error:22');
  ok(e.type === 'error' && e.code === 22 && /feed/i.test(e.text), 'error:22 explained');
  const a = G.parse('ALARM:4');
  ok(a.type === 'alarm' && a.code === 4 && /float/i.test(a.text) && /\$6/.test(a.hint), 'ALARM:4 explained for the float sensor');
  const st = G.parse('<Hold:0|MPos:10.000,-5.500,2.250|FS:120,0|Pn:P|WCO:1.000,2.000,3.000>');
  ok(st.type === 'status' && st.state === 'Hold' && st.sub === 0, 'status state and sub-state');
  ok(st.mpos[1] === -5.5 && st.wco[2] === 3 && st.feed === 120 && st.pins === 'P', 'status fields');
  ok(G.parse('<Idle|WPos:1.000,2.000,3.000|F:0>').wpos[2] === 3, 'WPos status');
  const p = G.parse('[PRB:0.000,1.500,-3.250:1]');
  ok(p.type === 'probe' && p.ok && p.pos[2] === -3.25, 'probe report');
  ok(G.parse('[MSG:Caution: Unlocked]').text === 'Caution: Unlocked', 'message');
  ok(G.parse("Grbl 1.1h ['$' for help]").version === '1.1h', 'welcome banner');
  ok(G.parse('$110=1500.000').n === 110, 'setting line');
  ok(G.parse('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]').modes.includes('G90'), 'parser state');
  ok(G.parse('') === null, 'blank line ignored');

  console.log('Machine state');
  const m = new G.Machine();
  m.update(G.parse('<Idle|MPos:10.000,20.000,30.000|FS:0,0|WCO:1.000,2.000,3.000>'));
  ok(near(m.wpos[0], 9) && near(m.wpos[2], 27), 'work position = machine - WCO');
  m.update(G.parse('<Run|MPos:11.000,20.000,30.000|FS:500,0>'));
  ok(near(m.wpos[0], 10) && m.state === 'Run' && !m.probe, 'WCO remembered between reports');
  m.update(G.parse('<Idle|MPos:11.000,20.000,30.000|FS:0,0|Pn:P>'));
  ok(m.probe, 'float sensor pin');

  console.log('Program prep');
  ok(G.clean('G0 X1.5 Y2 ; travel') === 'G0X1.5Y2', 'comments and spaces stripped');
  ok(G.clean('(MSG,Hole 1: place M3)') === '', 'message line sends nothing');
  ok(G.kindOf('G38.3Z11.9F60') === 'probe' && G.kindOf('M0') === 'pause' && G.kindOf('G4P2') === 'dwell'
    && G.kindOf('M2') === 'end' && G.kindOf('G0X1') === 'motion' && G.kindOf('G21G90') === 'setup', 'line kinds');
  ok(G.jog({ x: 10 }, 1500) === '$J=G91G21X10F1500' && G.jog({ y: -0.1, z: 1 }, 300) === '$J=G91G21Y-0.1Z1F300', 'jog commands');
  ok(G.setZero('XY') === 'G10L20P1X0Y0' && G.setZero('Z', { Z: -0.5 }) === 'G10L20P1Z-0.5', 'origin commands');

  // the example job
  const part = IP.stl.preparePart(IP.exampleBlock(), {});
  const det = IP.holes.detect(part.positions, {});
  const holes = det.holes.map((h, i) => ({ x: h.x, y: h.y, H: h.top, dia: h.dia, depth: h.depth, blind: h.blind,
    insert: IP.gcode.guessInsert(h.dia, 'm3'), label: String(i + 1) }));
  const job = IP.gcode.generate({ name: 'block', partTop: part.size.z, holes, settings: {} });
  const prog = G.prepare(job.text);
  ok(G.holesOf(prog).join() === holes.map((h) => h.label).join(), 'program knows every hole in order');
  ok(prog.filter((x) => x.boundary).length === holes.length + 1, 'a boundary at each hole and at the end');
  ok(prog.filter((x) => x.kind === 'pause').every((x) => x.msg), 'every pause carries its message');
  ok(/Hole 1: place M3/.test(prog.find((x) => x.kind === 'pause' && x.hole === '1').msg), 'pause message names the insert');
  ok(prog.every((x) => x.cmd.length < 72), 'cleaned lines are short');
  ok(prog.filter((x) => x.kind === 'probe').length === holes.length, 'one press per hole');

  /* ---------- rig: Link <-> VirtualGrbl ---------- */
  function rig(opts) {
    opts = opts || {};
    const queue = [];
    const sim = new IP.VirtualGrbl({ onLine: (l) => queue.push(l), probe: opts.probe, g54: opts.g54 || [0, 0, 0], log: [] });
    const link = new G.Link({ write: (l) => sim.receive(l + '\n'), writeByte: (b) => sim.receive(b) });
    const clock = { t: 0 };
    const events = [];
    for (const k of ['state', 'trip', 'lineError', 'alarm']) link.on(k, (d) => events.push([k, d]));
    const flush = () => { while (queue.length) link.receive(queue.shift(), clock.t); };
    let n = 0, maxIn = 0;
    const step = (dt) => {
      if (n++ % 10 === 0) sim.receive(0x3f);
      sim.tick(dt); clock.t += dt * 1000; flush();
      link.tick(clock.t);
      maxIn = Math.max(maxIn, link.streamer.inflight.length);
    };
    flush();
    const run = async (until, seconds, each) => {
      for (let i = 0; i < seconds / 0.02 && !until(); i++) {
        step(0.02);
        if (each) each();
        if (i % 5 === 0) await null; // let promise replies settle
      }
      await null;
    };
    const autoStart = () => {
      const c = link.streamer.current();
      if (link.machine.state === 'Hold' && link.streamer.state === 'running' && c && c.kind === 'pause') link.streamer.cycleStart();
    };
    return { sim, link, flush, step, run, autoStart, events, clock, maxIn: () => maxIn };
  }

  console.log('Streaming a whole job');
  const bed = (x, y, z) => z <= -0.5;
  const r1 = rig({ probe: bed });
  ok(r1.link.machine.version === '1.1h', 'link sees the GRBL banner');
  ok(r1.link.stream(prog, {}, 0), 'stream starts');
  await r1.run(() => r1.link.streamer.state === 'done', 900, r1.autoStart);
  const s1 = r1.link.streamer;
  ok(s1.state === 'done' && s1.acked === prog.length, `finished, ${s1.acked} of ${prog.length} lines answered`);
  ok(s1.errors.length === 0 && s1.trips.length === 0, 'no errors, no float trips');
  ok(r1.sim.overflow === 0 && r1.sim.maxRx <= 128, `receive buffer never overflowed (peak ${r1.sim.maxRx} bytes)`);
  ok(r1.maxIn() > 1, `streamed ahead (${r1.maxIn()} lines in flight at most)`);
  ok(near(r1.sim.work[0], 0) && near(r1.sim.work[1], 0) && near(r1.sim.work[2], job.clearZ), 'parked at X0 Y0, clear height');
  const presses = r1.sim.log.join('').split('\n').filter((l) => l.startsWith('G38.3'));
  ok(presses.length === holes.length, 'controller received every press');
  ok(Math.abs(r1.sim.time - job.seconds) < job.seconds * 0.25 + 15, `simulated time ${Math.round(r1.sim.time)} s vs estimate ${Math.round(job.seconds)} s`);

  console.log('Float trip watch');
  const target = holes[2];
  const stuck = (x, y, z) => z <= -0.5 || (Math.hypot(x - target.x, y - target.y) < 0.3 && z < target.H + 3);
  const r2 = rig({ probe: stuck });
  r2.link.stream(prog, { pauseOnTrip: true }, 0);
  await r2.run(() => ['trip', 'done'].includes(r2.link.streamer.state), 600, r2.autoStart);
  const s2 = r2.link.streamer;
  ok(s2.state === 'trip' && s2.trips.length === 1 && s2.trips[0].hole === '3', 'held after hole 3 tripped');
  const trip = s2.trips[0];
  ok(near(trip.mpos[2], target.H + 3, 0.05), `trip recorded at Z ${trip.mpos[2].toFixed(2)}`);
  const sentAfter = r2.sim.log.join('').split('\n').filter((l) => l.startsWith('G38.3')).length;
  ok(sentAfter === 3, 'nothing from hole 4 was sent while holding');
  await r2.run(() => r2.link.machine.state === 'Idle', 20);
  ok(near(r2.sim.work[2], job.clearZ, 0.01), 'tip lifted back to clear height before holding');
  s2.resume();
  await r2.run(() => s2.state === 'done', 900, r2.autoStart);
  ok(s2.state === 'done' && s2.trips.length === 1, 'continue finishes the job');

  console.log('Errors, stops, alarms');
  const bad = prog.slice(0, 12).concat([{ cmd: 'G28', src: -1, kind: 'setup', hole: '1', boundary: false }], prog.slice(12));
  const r3 = rig({ probe: bed });
  r3.link.stream(bad, {}, 0);
  await r3.run(() => r3.link.streamer.state !== 'running', 120, r3.autoStart);
  ok(r3.link.streamer.state === 'error' && r3.link.streamer.error.code === 20, 'GRBL error stops the stream');
  await r3.run(() => r3.link.machine.state === 'Hold', 5);
  ok(r3.sim.hold || r3.sim.state().startsWith('Hold'), 'feed hold sent after the error');
  r3.link.streamer.stop(r3.clock.t);
  await r3.run(() => r3.link.streamer.state === 'stopped', 10);
  ok(r3.link.streamer.state === 'stopped' && r3.sim.alarm === 0, 'stop resets without losing position');

  const r4 = rig({ probe: bed });
  r4.link.stream(prog, {}, 0);
  await r4.run(() => r4.link.machine.state === 'Run' && r4.sim.planner.length > 0 && !r4.sim.op, 60, r4.autoStart);
  ok(r4.sim._moving(), 'stopping while the tip is moving');
  r4.link.streamer.stop(r4.clock.t);
  await r4.run(() => r4.link.streamer.state === 'stopped', 10);
  ok(r4.link.streamer.state === 'stopped' && r4.sim.alarm === 0, 'feed hold first, so the reset does not raise ALARM:3');

  const r5 = rig({ probe: () => true });
  r5.link.stream(prog, {}, 0);
  await r5.run(() => !['running'].includes(r5.link.streamer.state), 120, r5.autoStart);
  ok(r5.link.streamer.state === 'alarm' && r5.link.streamer.error.alarm === 4, 'float pressed before a press: ALARM:4 ends the run');

  console.log('Check mode');
  const r6 = rig({ probe: bed });
  let reply;
  r6.link.command('$C').then((x) => { reply = x; });
  await r6.run(() => reply, 1);
  ok(reply && reply.type === 'ok' && r6.sim.check, '$C enters check mode');
  const before = r6.sim.mpos.slice();
  r6.link.stream(prog, { check: true }, 0);
  await r6.run(() => r6.link.streamer.state === 'done', 30);
  ok(r6.link.streamer.state === 'done' && r6.sim.mpos.every((v, i) => v === before[i]), 'check run finishes without moving');
  ok(r6.sim.time < 5, 'check run skips pauses and dwells');

  console.log('Commands');
  const r7 = rig({ probe: bed, g54: [-150, -150, -60] });
  const replies = [];
  r7.link.command(G.jog({ x: 12.5, y: -4 }, 1500)).then((x) => replies.push(x));
  await r7.run(() => replies.length && r7.link.machine.state === 'Idle' && r7.link.machine.statusCount > 3, 5);
  ok(replies[0].type === 'ok' && near(r7.sim.work[0], 162.5) && near(r7.sim.work[1], 146), 'jog moves relative');
  r7.link.command(G.setZero('XY')).then((x) => replies.push(x));
  await r7.run(() => replies.length > 1, 1);
  ok(near(r7.sim.work[0], 0) && near(r7.sim.work[1], 0), 'G10 L20 sets X0 Y0 at the tip');
  r7.link.command('G28').then((x) => replies.push(x));
  await r7.run(() => replies.length > 2, 1);
  ok(replies[2].type === 'error' && replies[2].code === 20, 'unsupported command comes back as an error');
  ok(r7.link.command('$X') instanceof Promise, 'commands return promises');

  console.log('Touch-off with the float');
  const trav = 0.5;
  const r8 = rig({ probe: (x, y, z) => z <= -trav, g54: [0, 0, -40] }); // bed is 40 mm below the tip
  const out = [];
  let prb = null;
  r8.link.on('line', (l, msg) => { if (msg.type === 'probe') prb = msg; });
  r8.link.command('G90G38.2Z-10F300').then((x) => out.push(x));
  await r8.run(() => out.length, 30);
  ok(prb && prb.ok, 'probe tripped on the bed');
  const g54z = prb.pos[2] + trav;
  r8.link.command('G10L2P1Z' + G.f3(g54z)).then((x) => out.push(x));
  await r8.run(() => out.length > 1, 1);
  ok(near(r8.sim.work[2], -trav, 0.02), `tip reads Z ${r8.sim.work[2].toFixed(3)} with the float compressed`);
  let alarmSeen = false;
  const r9 = rig({ probe: () => false });
  r9.link.on('alarm', () => { alarmSeen = true; });
  const o9 = [];
  r9.link.command('G90G38.2Z-5F600').then((x) => o9.push(x));
  await r9.run(() => o9.length, 30);
  ok(alarmSeen && o9[0] && r9.sim.alarm === 5, 'touch-off that finds nothing raises ALARM:5');
};
