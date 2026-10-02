/* InsertPress Planner — connections to the controller.
 *   SerialPort: a real GRBL over USB with Web Serial (Chrome/Edge on desktop)
 *   SimPort:    the virtual GRBL in grbl-sim.js, for rehearsals
 * Both: open(), close(), write(line), writeByte(b); handlers { onLine(line), onClose(reason) }.
 */
(function () {
  'use strict';
  const IP = window.IP;

  class SerialPort {
    static supported() { return typeof navigator !== 'undefined' && 'serial' in navigator; }
    constructor(h) { this.h = h; this.kind = 'usb'; this.alive = false; }
    async open(baud) {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: baud || 115200 });
      this.alive = true;
      this.writer = this.port.writable.getWriter();
      this._disc = (e) => { if (e.target === this.port || e.port === this.port) this._lost('The USB cable was unplugged.'); };
      navigator.serial.addEventListener('disconnect', this._disc);
      this._read();
    }
    async _read() {
      const dec = new TextDecoder();
      let buf = '';
      try {
        while (this.alive && this.port.readable) {
          this.reader = this.port.readable.getReader();
          try {
            for (;;) {
              const { value, done } = await this.reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              let i;
              while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).replace(/\r$/, '');
                buf = buf.slice(i + 1);
                this.h.onLine(line);
              }
            }
          } finally { try { this.reader.releaseLock(); } catch (e) { /* already released */ } }
        }
      } catch (e) { this._lost(e.message || 'Reading from the port failed.'); }
    }
    write(line) { if (this.alive) this.writer.write(new TextEncoder().encode(line + '\n')).catch((e) => this._lost(e.message)); }
    writeByte(b) { if (this.alive) this.writer.write(new Uint8Array([b])).catch(() => {}); }
    async close() {
      if (!this.alive) return;
      this.alive = false;
      try { await this.reader.cancel(); } catch (e) { /* closed */ }
      try { this.writer.releaseLock(); } catch (e) { /* closed */ }
      try { await this.port.close(); } catch (e) { /* closed */ }
      navigator.serial.removeEventListener('disconnect', this._disc);
      if (this.h.onClose) this.h.onClose(null);
    }
    _lost(why) {
      if (!this.alive) return;
      this.alive = false;
      try { this.port.close(); } catch (e) { /* closed */ }
      if (this.h.onClose) this.h.onClose(why);
    }
  }

  class SimPort {
    constructor(h, opts) { this.h = h; this.opts = opts || {}; this.kind = 'sim'; this.speed = 4; this.alive = false; }
    async open() {
      this.alive = true;
      const out = [];
      const flush = () => { while (out.length && this.alive) this.h.onLine(out.shift()); };
      this.sim = new IP.VirtualGrbl({
        onLine: (l) => { out.push(l); setTimeout(flush, 0); },
        probe: this.opts.probe, g54: [-150, -150, -60], rapid: this.opts.rapid,
      });
      this.last = performance.now();
      this.timer = setInterval(() => {
        const now = performance.now();
        this.sim.tick(Math.min(0.2, (now - this.last) / 1000) * this.speed);
        this.last = now;
      }, 20);
    }
    write(line) { if (this.alive) this.sim.receive(line + '\n'); }
    writeByte(b) { if (this.alive) this.sim.receive(b); }
    async close() {
      if (!this.alive) return;
      this.alive = false;
      clearInterval(this.timer);
      if (this.h.onClose) this.h.onClose(null);
    }
  }

  IP.SerialPort = SerialPort;
  IP.SimPort = SimPort;
})();
