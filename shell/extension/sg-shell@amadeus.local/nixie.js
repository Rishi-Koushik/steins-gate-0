// Divergence-meter tubes: wire-filament digits drawn with cairo (same glyph paths as demo/index.html `GL`).
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

const GL = {
    0: 'M30 3C10 3 6 28 6 50C6 72 10 97 30 97C50 97 54 72 54 50C54 28 50 3 30 3Z',
    1: 'M30 3V97M30 3L13 21M16 97H44',
    2: 'M7 28C9 8 51 3 53 27C55 50 9 72 6 97H54',
    3: 'M8 15C20 1 52 6 50 28C48 45 30 48 24 48C46 48 55 62 52 76C48 98 14 100 6 84',
    4: 'M42 97V3L4 67H56',
    5: 'M50 5H13L8 47C30 37 54 49 52 72C50 98 16 100 6 87',
    6: 'M48 9C26 -3 6 26 6 64C6 100 50 100 52 70C54 44 20 38 8 62',
    7: 'M5 5H55L22 97',
    8: 'M30 50C8 46 10 5 30 5C50 5 52 46 30 50C6 54 6 97 30 97C54 97 54 54 30 50Z',
    9: 'M52 38C52 10 12 6 8 32C6 54 46 60 52 38C52 62 40 97 14 91',
};

// Absolute-command SVG path (M L H V C Z) → list of [cmd, ...numbers].
function parsePath(d) {
    const out = [];
    const re = /([MLHVCZ])([^MLHVCZ]*)/g;
    let m;
    while ((m = re.exec(d)) !== null) {
        const nums = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
        out.push([m[1], ...nums]);
    }
    return out;
}
const PATHS = Object.fromEntries(Object.entries(GL).map(([k, d]) => [k, parsePath(d)]));

function trace(cr, segs) {
    let x = 0, y = 0;
    for (const [c, ...n] of segs) {
        switch (c) {
        case 'M': [x, y] = n; cr.moveTo(x, y); break;
        case 'L': for (let i = 0; i + 1 < n.length; i += 2) { x = n[i]; y = n[i + 1]; cr.lineTo(x, y); } break;
        case 'H': x = n[0]; cr.lineTo(x, y); break;
        case 'V': y = n[0]; cr.lineTo(x, y); break;
        case 'C':
            for (let i = 0; i + 5 < n.length; i += 6) {
                cr.curveTo(n[i], n[i + 1], n[i + 2], n[i + 3], n[i + 4], n[i + 5]);
                x = n[i + 4]; y = n[i + 5];
            }
            break;
        case 'Z': cr.closePath(); break;
        }
    }
}

export const Tube = GObject.registerClass(
class SgNixieTube extends St.DrawingArea {
    _init(width, height) {
        super._init({width, height});
        this._ch = null;
        this.connect('repaint', () => this._paint());
    }

    // ch: '0'..'9', '.', '*' (masked character), or null (unlit)
    setChar(ch) {
        if (ch === this._ch) return;
        const wasLit = this._ch !== null;
        this._ch = ch;
        this.queue_repaint();
        // lit tubes flicker gently (demo: nxflick 3.2s infinite)
        const lit = ch !== null;
        if (lit !== wasLit) {
            this.remove_all_transitions();
            this.opacity = 255;
            if (lit) {
                this.ease({
                    opacity: 150, duration: 1100 + Math.floor(Math.random() * 900), delay: Math.floor(Math.random() * 600),
                    mode: Clutter.AnimationMode.EASE_IN_OUT_SINE, repeatCount: -1, autoReverse: true,
                });
            }
        }
    }

    _paint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const r = Math.min(w, h) * 0.14;

        // glass body
        cr.newPath();
        cr.moveTo(r, 0); cr.lineTo(w - r, 0); cr.arc(w - r, r, r, -Math.PI / 2, 0);
        cr.lineTo(w, h - r / 2); cr.arc(w - r / 2, h - r / 2, r / 2, 0, Math.PI / 2);
        cr.lineTo(r / 2, h); cr.arc(r / 2, h - r / 2, r / 2, Math.PI / 2, Math.PI);
        cr.lineTo(0, r); cr.arc(r, r, r, Math.PI, 1.5 * Math.PI);
        cr.closePath();
        cr.setSourceRGBA(0.075, 0.045, 0.025, 1);
        cr.fillPreserve();
        cr.clip();

        // diagonal mesh
        cr.setLineWidth(1);
        cr.setSourceRGBA(1, 0.59, 0.16, 0.10);
        const step = Math.max(8, w * 0.13), slope = 1.88;
        for (let x = -h * 2; x < w + h * 2; x += step) {
            cr.moveTo(x, 0); cr.lineTo(x + h / slope, h);
            cr.moveTo(x, 0); cr.lineTo(x - h / slope, h);
        }
        cr.stroke();

        // glyph space: viewBox 70x130, glyphs at translate(5,15)
        const s = Math.min(w / 70, h / 130);
        cr.translate((w - 70 * s) / 2 + 5 * s, (h - 130 * s) / 2 + 15 * s);
        cr.scale(s, s);
        cr.setLineCap(1); // round
        cr.setLineJoin(1);

        // ghost digits
        cr.setLineWidth(1.1);
        cr.setSourceRGBA(1, 0.59, 0.16, 0.20);
        for (const segs of Object.values(PATHS)) { cr.newPath(); trace(cr, segs); cr.stroke(); }

        const ch = this._ch;
        if (ch === '.' || ch === '*') {
            const [cx, cy, rad] = ch === '.' ? [9, 96, 3.6] : [30, 50, 6];
            for (const [k, a] of [[3.2, 0.10], [2.2, 0.22], [1.5, 0.4]]) {
                cr.setSourceRGBA(1, 0.42, 0, a); cr.arc(cx, cy, rad * k, 0, 2 * Math.PI); cr.fill();
            }
            cr.setSourceRGBA(1, 0.757, 0.353, 1); cr.arc(cx, cy, rad, 0, 2 * Math.PI); cr.fill();
        } else if (ch !== null && PATHS[ch]) {
            // blurred under-stroke approximated by stacked translucent strokes
            for (const [lw, a] of [[16, 0.07], [11, 0.12], [7, 0.22], [4.5, 0.35]]) {
                cr.newPath(); trace(cr, PATHS[ch]);
                cr.setLineWidth(lw); cr.setSourceRGBA(1, 0.416, 0, a); cr.stroke();
            }
            cr.newPath(); trace(cr, PATHS[ch]);
            cr.setLineWidth(2.4); cr.setSourceRGBA(1, 0.757, 0.353, 1); cr.stroke();
        }
        cr.$dispose();
    }
});

export const Meter = GObject.registerClass(
class SgNixieMeter extends St.BoxLayout {
    _init(s) {
        super._init({
            style: `spacing: ${Math.round(8 * s)}px; padding: ${Math.round(18 * s)}px ${Math.round(20 * s)}px ${Math.round(24 * s)}px;` +
                `background-color: #0f0b08; border: 1px solid #3a2a18; border-radius: ${Math.round(8 * s)}px;`,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.tubes = [];
        for (let i = 0; i < 8; i++) {
            const t = new Tube(Math.round(78 * s), Math.round(176 * s));
            this.add_child(t);
            this.tubes.push(t);
        }
    }

    show8(chars) {
        chars.forEach((c, i) => this.tubes[i]?.setChar(c ?? null));
    }
});
