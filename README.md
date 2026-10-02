# InsertPress Planner

A slicer-style planner for a heat-set insert press. Load an STL, place it on
the bed, pick the holes, preview the job, and download GRBL 1.1 G-code. Runs
entirely in the browser: no install, no build step, no server.

![Screenshot](docs/screenshot.png)
<!-- Add a screenshot: load the example block, set 3 x 2 copies, save as docs/screenshot.png -->

## Try it

- **Locally:** open `index.html` in Chrome, Firefox, or Edge.
- **GitHub Pages:** push this repo, then Settings → Pages → Deploy from branch →
  `main` / root. The app will be at `https://<you>.github.io/<repo>/`.

Click **Example block** to see it work without your own part, or **Bracket, tall wall**
to see the iron collision check catch three holes next to a 60 mm upright. The 3D
view loads Three.js from jsDelivr; without a connection the app switches to a
2D top view and everything else still works.

## What it does

**1. Part.** Open or drop an STL. You get its size, volume, and surface area.
Turn it on X or Y until the insert holes face up. Position it on the bed by
typing X, Y, and an angle, with the Move tool (drag the part), or with
**Into fence corner** and **Center on bed**. **Copies** lays out a grid of the
same part so one job presses a whole batch, and tells you if the array runs
past your travel.

**2. Holes.** Insert-sized holes that open upward are found automatically.
Click a ring in the view or the **+** on a row to press it. The list filters
by size (the chips) and by status (All, Pressing, Skipped, Issues), and sorts
by press order, X, Y, diameter, depth, wall, or insert. Select several holes
with the checkboxes, Ctrl/Cmd-click, Shift-click, Shift-click in the view, or
Shift-drag a box in the view, then press, skip, change the insert, or set the
finish depth for all of them at once. **Press in this order** turns a sort into
the press order. Drag the number tags to reorder or press **Shortest path**. Click a row to open its inspector: measured diameter versus
what the insert wants, knurl OD, depth versus insert length, wall thickness,
bed coordinates, and press depth. Use the Place tool to add holes the finder
missed.

**Iron collision check.** The iron is modelled as a stack of cylinders from
the tip end up: tip, tip nut, iron body, and optionally the Z carriage (set
them under Machine, Iron and clearances; the drawing there is to scale). At the
bottom of every press, anything inside one of those cylinders that rises above
the surface the insert goes into is a collision: the part itself, the copy
next to it, or the fence. Colliding holes turn red in the view and the list,
the iron is drawn around the hole you point at, and the job can't be
downloaded or run until it's fixed. **The default dimensions are a guess at a
Pinecil V2 with a press tip. Measure yours.**

**Measure (R).** Click two points for the distance with ΔX, ΔY, ΔZ. Points
snap to hole centres and part corners.

**3. Machine.** Pick a plastic (PLA, PETG, ABS, ASA, Nylon, PC) to fill in a
starting iron temperature, press speed, and hold time. Every feed, height,
and travel limit is editable. Save setups as named **machine profiles**, such
as one for the Z-only press head and one for the full gantry.

**4. Preview.** Job time with a breakdown (travel, Z moves, pressing,
holding, lifting, loading), inserts per part, X/Y travel distance, a parts list
with cost, and warnings. Press play to watch the iron work through the job;
the G-code line it's on is highlighted. Download the G-code, an **air pass**
(the same job 20 mm higher, nothing touches), or a **1:1 placement template**
(SVG) that shows where each part sits on the bed.

**Run it from the browser.** **Machine** in the top bar opens the panel.
Connect over USB (Web Serial: Chrome or Edge on a desktop, from `file://` or
GitHub Pages) or **rehearse on the simulator**, a virtual GRBL that runs the
same protocol with no hardware. The panel shows work and machine position, the
GRBL state, and whether the float sensor reads pressed. Jog by 0.1 to 50 mm
(click to step, hold to keep moving), set X0 Y0 and Z0 at the tip, or touch
off Z with the float. Before a run you get a short checklist; during it, every
M0 pause shows its message with a big **Continue** (and a chime), and holes
turn into brass inserts as they're pressed. Options: start at any hole, press
only one hole (test press), air pass, and **stop between holes if the float
trips**: the press uses G38.3, so a trip means the insert met resistance; the
panel reports the hole and how far short it stopped, lets the lift finish, and
holds before the next hole. Stop is a feed hold followed by a soft reset once
motion stops, so position is kept (no ALARM:3). After a stop or a trip, Start
at hole moves to the first unfinished one. **Check every line on the
controller** runs the job through GRBL's check mode (`$C`). There's a console
for `$$` and friends, live press-speed override, and alarms come with
plain-language explanations and an Unlock button. The screen stays awake during
a run and closing the tab asks first.

Everything is undoable. **Save job** writes a `.ipjob.json` with the placement,
copies, picks, and settings; **Open job**, then the same STL, picks up where
you left off.

## Keyboard

| Key | Action |
|---|---|
| V / M / H / R | Select, Move, Place, Measure |
| Shift-click, Shift-drag | Select holes in the view |
| Ctrl+A | Select every hole shown in the list |
| I | Show or hide the iron around the hole you point at |
| ? | Keyboard shortcuts |
| Arrows | Nudge the part 1 mm (Shift: 10 mm) with Move |
| Shift while dragging | 0.1 mm steps instead of 0.5 mm |
| Space | Play or pause the preview |
| F | Fit the view |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Delete | Take the selected holes out of the press order |
| Esc | Clear the measurement, then the selection, then back to Select |
| Arrows, Page Up/Down | Jog, while the machine panel has focus |

## Machine setup this G-code assumes

| What | Convention |
|---|---|
| X0 Y0 | Inside corner of the fence |
| Z0 | Tip touching the bed with the spring float relaxed (paper test) |
| Units / mode | `G21 G90`, work coordinates `G54` |
| Float sensor | Wired to the GRBL probe pin (A5) |

Set the origin once per session: jog the tip into the fence corner and run
`G10 L20 P1 X0 Y0`, then touch off on the bed and run `G10 L20 P1 Z0`.

Each hole runs this sequence:

```
G0 X.. Y..             travel at clear height
(MSG,...) M0           pause: place the insert, then Cycle Start
G0 Z(H + L + gap)      drop to just above the insert
G38.3 Z(H - sink) F..  press; halts early if the float sensor trips
G4 P..                 hold at depth while the plastic sets
G1 Z.. F..             slow lift off the insert
G0 Z(clear)            back to travel height
```

`H` is the surface height at the hole, `L` the insert length, and clear height
is part top + longest insert + clearance. With copies, holes are numbered
through the whole batch and pressed copy by copy, row by row.

**Z only mode** is for the press head before the gantry exists: no X/Y moves;
the job pauses at each hole with its coordinates so you slide the part under
the tip.

**Placing parts:** with one part, push it into the fence corner (X 0, Y 0).
For anything else, print the placement template at 100%, check the 50 mm
scale bar, put the sheet's corner in the fence corner, and set each part on
its outline.

**First run:** do an air pass with the iron cold and Z0 set 20 mm above the
bed, then one test hole, before running a real part.

## How hole finding works

STL files are only triangles, so holes are found geometrically: near-vertical
triangles are grouped into connected wall patches, each patch gets a circle
fit, and a patch counts as a hole when it is round, wraps most of the way
around, and its normals face the axis (a round boss faces outward and is
skipped). If material covers the hole's center above its top, it opens
downward and is skipped. Wall thickness is the distance to the nearest other
vertical wall over the hole's height, minus its radius.

Limits: holes must be vertical in the chosen orientation; very low-poly
exports (under about 8 segments per circle) or holes cut by other features
may be missed. Place those by hand. The template uses each part's convex
outline.

## Project layout

```
index.html           page shell
css/style.css        base styles
css/v4.css           machine panel, hole list, measure, iron
js/stl.js            STL parsing, orientation, dropping the part onto the bed
js/holes.js          hole detection and wall thickness
js/placement.js      position, rotation, copies, footprint, volume
js/gcode.js          inserts, materials, defaults, checks, G-code, air pass, timeline
js/collision.js      iron collision check against the part, copies, and fence
js/holelist.js       hole list filtering, sorting, selection ranges
js/measure.js        distances and snapping
js/grbl.js           GRBL 1.1 replies, error/alarm text, program prep, streamer
js/grbl-sim.js       virtual GRBL for rehearsals and tests
js/serial.js         Web Serial and simulator connections
js/viewer.js         Three.js view
js/viewer2d.js       2D top view with the same interface
js/ui-holes.js       hole list UI
js/ui-machine.js     machine panel UI
js/app.js            state, history, profiles, preview, template, wiring
js/example.js        example block, bracket, and the cell-grid mesher
examples/            example-block.stl, example-bracket.stl
test/                Node tests, one file per area
tools/               example STL generator
```

## Tests

```
node test/run-tests.js          # everything
node test/run-tests.js grbl     # one file
```

No dependencies. Covers STL parsing, hole detection, placement and copies,
inserts, G-code and the air pass, the timeline, path ordering, the collision
check (the bracket, copies, the fence, clipping), the hole list, measuring, and
GRBL end to end: whole jobs streamed into the virtual controller with the
128-byte buffer checked, float trips, rejected lines, stops, alarms, check
mode, jogging, origins, and touch-off.

## Roadmap

- Restore the last session after a reload

- Per-hole surface touch-off for warped parts
- Feeder support: pick-up moves instead of load pauses
- STEP/3MF import

## License

MIT
