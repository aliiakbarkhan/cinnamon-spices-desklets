const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const Settings = imports.ui.settings;

const UUID = "screentime@local";
const DATA_FILE = GLib.get_home_dir() + "/.cache/screentime-desklet.json";
const CHECK_INTERVAL_SECONDS = 5;

function _todayStr() {
    let d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

function _formatTime(totalSeconds, showSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    let h = Math.floor(totalSeconds / 3600);
    let m = Math.floor((totalSeconds % 3600) / 60);
    let s = totalSeconds % 60;

    if (showSeconds) {
        return h + "h " + m + "m " + s + "s";
    }
    return h + "h " + m + "m";
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function (metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.metadata = metadata;
        this.desklet_id = desklet_id;

        // Settings
        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this.settings.bind("idle-threshold", "idleThreshold", this._onSettingsChanged);
        this.settings.bind("show-seconds", "showSeconds", this._onSettingsChanged);
        this.settings.bind("font-size", "fontSize", this._onSettingsChanged);

        // State
        this.activeSeconds = 0;
        this.currentDate = _todayStr();

        this._loadData();

        // UI
        this._label = new St.Label({ style_class: "screentime-label" });
        this._applyStyle();
        this.setContent(this._label);
        this._updateLabel();

        // Idle monitoring via Mutter's core idle monitor (tracks keyboard/mouse input)
        this._idleMonitor = Meta.IdleMonitor.get_core();
        this._lastCheck = GLib.get_monotonic_time();

        this._timeoutId = Mainloop.timeout_add_seconds(
            CHECK_INTERVAL_SECONDS,
            Lang.bind(this, this._tick)
        );
    },

    _onSettingsChanged: function () {
        this._applyStyle();
        this._updateLabel();
    },

    _applyStyle: function () {
        this._label.style = "font-size: " + (this.fontSize || 16) + "px;";
    },

    _loadData: function () {
        try {
            if (GLib.file_test(DATA_FILE, GLib.FileTest.EXISTS)) {
                let [ok, contents] = GLib.file_get_contents(DATA_FILE);
                if (ok) {
                    let text = imports.byteArray
                        ? imports.byteArray.toString(contents)
                        : contents.toString();
                    let data = JSON.parse(text);
                    if (data.date === _todayStr()) {
                        this.activeSeconds = data.activeSeconds || 0;
                        this.currentDate = data.date;
                    } else {
                        // Stale data from a previous day: start fresh
                        this.activeSeconds = 0;
                        this.currentDate = _todayStr();
                    }
                }
            }
        } catch (e) {
            global.logError("screentime desklet: failed to load data - " + e);
            this.activeSeconds = 0;
            this.currentDate = _todayStr();
        }
    },

    _saveData: function () {
        try {
            let data = JSON.stringify({
                date: this.currentDate,
                activeSeconds: Math.floor(this.activeSeconds),
            });
            GLib.file_set_contents(DATA_FILE, data);
        } catch (e) {
            global.logError("screentime desklet: failed to save data - " + e);
        }
    },

    _tick: function () {
        let today = _todayStr();
        if (today !== this.currentDate) {
            // New day: reset the counter
            this.currentDate = today;
            this.activeSeconds = 0;
        }

        let now = GLib.get_monotonic_time();
        let elapsedSeconds = (now - this._lastCheck) / 1000000;
        this._lastCheck = now;

        // Clamp in case the system was suspended for a long time
        if (elapsedSeconds > CHECK_INTERVAL_SECONDS * 4) {
            elapsedSeconds = CHECK_INTERVAL_SECONDS;
        }

        let idleTimeMs = this._idleMonitor.get_idletime();
        let thresholdMs = (this.idleThreshold || 60) * 1000;

        if (idleTimeMs < thresholdMs) {
            this.activeSeconds += elapsedSeconds;
        }

        this._updateLabel();
        this._saveData();

        return true; // keep the timeout running
    },

    _updateLabel: function () {
        this._label.set_text(_formatTime(this.activeSeconds, this.showSeconds));
    },

    on_desklet_removed: function () {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._saveData();
    },
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
