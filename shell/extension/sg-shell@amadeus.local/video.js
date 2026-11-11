// GStreamer playback inside gnome-shell: decoded RGBA frames are pulled from an
// appsink on the main loop (never from a streaming thread) and uploaded into an
// St.ImageContent. Audio goes to the default sink through playbin.
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import St from 'gi://St';
import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';

let inited = false;
function ensureInit() {
    if (!inited) {
        Gst.init(null);
        inited = true;
    }
}

const PLAY_FLAG_VIDEO = 1, PLAY_FLAG_AUDIO = 2;

export class Player {
    // params: file, video (bool), audio (bool), loop, volume, width, height, fps, onEnded
    constructor(params) {
        ensureInit();
        this._p = Object.assign({video: true, audio: true, loop: false, volume: 1, width: 1280, height: 720, fps: 30}, params);
        this._pollId = 0;
        this._destroyed = false;

        this._bin = Gst.ElementFactory.make('playbin', null);
        if (!this._bin)
            throw new Error('playbin unavailable');
        this._bin.set_property('uri', GLib.filename_to_uri(this._p.file, null));
        this._bin.set_property('flags',
            (this._p.video ? PLAY_FLAG_VIDEO : 0) | (this._p.audio ? PLAY_FLAG_AUDIO : 0));
        this._bin.set_property('volume', this._p.volume);

        if (this._p.video) {
            const {width, height, fps} = this._p;
            const desc = 'videoconvert ! videoscale ! videorate ! ' +
                `capsfilter caps="video/x-raw,format=RGBA,width=${width},height=${height},framerate=${fps}/1" ! ` +
                'appsink name=sgsink max-buffers=2 drop=true sync=true';
            const sinkBin = Gst.parse_bin_from_description(desc, true);
            this._sink = sinkBin.get_by_name('sgsink');
            this._bin.set_property('video-sink', sinkBin);
            this.content = St.ImageContent.new_with_preferred_size(width, height);
            this._cogl = global.stage.context.get_backend().get_cogl_context();
        }

        this._bus = this._bin.get_bus();
        this._bus.add_signal_watch();
        this._busIds = [
            this._bus.connect('message::eos', () => this._onEos()),
            this._bus.connect('message::error', (_b, msg) => {
                try {
                    const [err] = msg.parse_error();
                    console.warn(`[sg-shell] gst error: ${err.message}`);
                } catch {}
                this._p.onError?.();
            }),
        ];
    }

    play() {
        if (this._destroyed) return;
        this._bin.set_state(Gst.State.PLAYING);
        if (this._sink && !this._pollId) {
            const interval = Math.max(10, Math.floor(1000 / this._p.fps / 2));
            this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
                this._pull();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    pause() {
        if (this._destroyed) return;
        this._bin.set_state(Gst.State.PAUSED);
        this._stopPoll();
    }

    _stopPoll() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    _pull() {
        let sample;
        try {
            sample = this._sink.emit('try-pull-sample', 0);
        } catch {
            return;
        }
        if (!sample) return;
        const buf = sample.get_buffer();
        if (!buf) return;
        const {width, height} = this._p;
        const data = buf.extract_dup(0, width * height * 4);
        if (!data || data.length < width * height * 4) return;
        try {
            this.content.set_bytes(this._cogl, new GLib.Bytes(data),
                Cogl.PixelFormat.RGBA_8888_PRE, width, height, width * 4);
            this.frames = (this.frames ?? 0) + 1;
        } catch (e) {
            if (!this._warned) {
                this._warned = true;
                console.warn(`[sg-shell] frame upload failed: ${e.message}`);
            }
        }
    }

    _onEos() {
        if (this._destroyed) return;
        if (this._p.loop) {
            this._bin.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, 0);
        } else {
            this._stopPoll();
            this._p.onEnded?.();
        }
    }

    setVolume(v) {
        if (!this._destroyed) this._bin.set_property('volume', v);
    }

    // An actor showing the video, sized by the caller.
    makeActor() {
        return new Clutter.Actor({
            content: this.content,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
            minification_filter: Clutter.ScalingFilter.LINEAR,
            magnification_filter: Clutter.ScalingFilter.LINEAR,
        });
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._stopPoll();
        try {
            for (const id of this._busIds) this._bus.disconnect(id);
            this._bus.remove_signal_watch();
        } catch {}
        this._bin.set_state(Gst.State.NULL);
        this._bin = null;
        this._sink = null;
        this.content = null;
    }
}
