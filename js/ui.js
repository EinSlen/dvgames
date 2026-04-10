import { BlockProps } from './textures.js';

export class UI {
    constructor() {
        this.container = document.getElementById('ui');
        this._createCrosshair();
        this._createHotbar();
        this._createDebugInfo();
        this._createStartScreen();
        this._createPauseScreen();
        this._createRoomInfo();

        this._lastDebugUpdate = 0;
        this._debugVisible = true;
        this._dFps = document.getElementById('debug-fps');
        this._dPos = document.getElementById('debug-pos');
        this._dChunk = document.getElementById('debug-chunk');
        this._dChunks = document.getElementById('debug-chunks');
        this._dBlock = document.getElementById('debug-block');
    }

    _createCrosshair() {
        const el = document.createElement('div');
        el.id = 'crosshair'; el.textContent = '+';
        this.container.appendChild(el);
    }

    _createHotbar() {
        const bar = document.createElement('div');
        bar.id = 'hotbar';
        this.hotbarSlots = [];
        for (let i = 0; i < 9; i++) {
            const slot = document.createElement('div'); slot.className = 'hotbar-slot';
            const label = document.createElement('span'); label.className = 'slot-number'; label.textContent = i + 1;
            const name = document.createElement('span'); name.className = 'slot-name';
            slot.appendChild(label); slot.appendChild(name);
            bar.appendChild(slot);
            this.hotbarSlots.push({ slot, name, prevName: '', prevSel: false });
        }
        this.container.appendChild(bar);
    }

    _createDebugInfo() {
        const d = document.createElement('div'); d.id = 'debug-info';
        d.innerHTML = '<div id="debug-fps">FPS: --</div><div id="debug-pos">XYZ: --</div><div id="debug-chunk">Chunk: --</div><div id="debug-chunks">Chunks: --</div><div id="debug-block">Looking at: --</div>';
        this.container.appendChild(d);
    }

    _createStartScreen() {
        const screen = document.createElement('div');
        screen.id = 'start-screen';
        screen.innerHTML = `
            <h1>MiniCraft 3D</h1>
            <div class="menu-section">
                <input type="text" id="player-name" placeholder="Ton pseudo" maxlength="16" value="Steve">
            </div>
            <div class="menu-buttons">
                <button id="btn-solo">Jouer Solo</button>
                <button id="btn-host">Cr&eacute;er une partie</button>
                <div class="join-row">
                    <input type="text" id="room-code-input" placeholder="CODE" maxlength="5">
                    <button id="btn-join">Rejoindre</button>
                </div>
            </div>
            <div id="menu-status"></div>
            <div class="controls-info">
                <div><b>WASD</b> - Se d&eacute;placer &nbsp; <b>Souris</b> - Regarder</div>
                <div><b>Clic G</b> - Casser &nbsp; <b>Clic D</b> - Poser &nbsp; <b>Espace</b> - Sauter</div>
                <div><b>1-9</b> - Bloc &nbsp; <b>F</b> - Vol &nbsp; <b>Shift</b> - Sprint &nbsp; <b>F3</b> - Debug</div>
            </div>
        `;
        this.startScreen = screen;
        this.container.appendChild(screen);
    }

    _createPauseScreen() {
        const el = document.createElement('div');
        el.id = 'pause-screen';
        el.style.display = 'none';
        el.innerHTML = '<p>Cliquez pour reprendre</p>';
        this.container.appendChild(el);
        this.pauseScreen = el;
    }

    _createRoomInfo() {
        const el = document.createElement('div');
        el.id = 'room-info';
        el.style.display = 'none';
        this.container.appendChild(el);
        this.roomInfo = el;
    }

    // ── Menu API ──
    getPlayerName() { return document.getElementById('player-name').value.trim() || 'Steve'; }
    getRoomCode() { return document.getElementById('room-code-input').value.trim().toUpperCase(); }

    onSolo(fn) { document.getElementById('btn-solo').addEventListener('click', () => fn()); }
    onHost(fn) { document.getElementById('btn-host').addEventListener('click', () => fn()); }
    onJoin(fn) { document.getElementById('btn-join').addEventListener('click', () => fn()); }

    setStatus(msg) { document.getElementById('menu-status').textContent = msg; }

    showRoomCode(code) {
        this.roomInfo.textContent = 'Code: ' + code;
        this.roomInfo.style.display = 'block';
    }

    hideStartScreen() { this.startScreen.style.display = 'none'; this.pauseScreen.style.display = 'none'; }
    showStartScreen() { this.startScreen.style.display = 'flex'; this.pauseScreen.style.display = 'none'; }
    showPauseScreen() { this.startScreen.style.display = 'none'; this.pauseScreen.style.display = 'flex'; }

    updateHotbar(hotbar, selectedSlot) {
        for (let i = 0; i < 9; i++) {
            const s = this.hotbarSlots[i];
            const sel = i === selectedSlot;
            if (s.prevSel !== sel) { s.slot.className = 'hotbar-slot' + (sel ? ' selected' : ''); s.prevSel = sel; }
            const p = BlockProps[hotbar[i]]; const n = p ? p.name : '';
            if (s.prevName !== n) { s.name.textContent = n; s.prevName = n; }
        }
    }

    updateDebug(fps, player, selectedBlock, chunkCount) {
        if (!this._debugVisible) return;
        const now = performance.now();
        if (now - this._lastDebugUpdate < 100) return;
        this._lastDebugUpdate = now;
        this._dFps.textContent = `FPS: ${fps}`;
        this._dPos.textContent = `XYZ: ${player.position.x.toFixed(1)} / ${player.position.y.toFixed(1)} / ${player.position.z.toFixed(1)}`;
        this._dChunk.textContent = `Chunk: ${Math.floor(player.position.x / 16)}, ${Math.floor(player.position.z / 16)}`;
        this._dChunks.textContent = `Chunks: ${chunkCount}`;
        if (selectedBlock) { const p = BlockProps[selectedBlock.block]; this._dBlock.textContent = `Looking at: ${p.name} (${selectedBlock.x}, ${selectedBlock.y}, ${selectedBlock.z})`; }
        else this._dBlock.textContent = 'Looking at: --';
    }

    toggleDebug() {
        this._debugVisible = !this._debugVisible;
        document.getElementById('debug-info').style.display = this._debugVisible ? 'block' : 'none';
    }
}
