import { BlockProps } from './textures.js';

export class UI {
    constructor() {
        this.container = document.getElementById('ui');
        this._createCrosshair();
        this._createHotbar();
        this._createDebugInfo();
        this._createStartScreen();

        // Throttle: only update DOM every 100ms
        this._lastDebugUpdate = 0;
        this._lastHotbarSlot = -1;
        this._debugVisible = true;

        // Cache DOM refs
        this._dFps = document.getElementById('debug-fps');
        this._dPos = document.getElementById('debug-pos');
        this._dChunk = document.getElementById('debug-chunk');
        this._dBlock = document.getElementById('debug-block');
        this._dChunks = document.getElementById('debug-chunks');
    }

    _createCrosshair() {
        const el = document.createElement('div');
        el.id = 'crosshair';
        el.textContent = '+';
        this.container.appendChild(el);
    }

    _createHotbar() {
        const bar = document.createElement('div');
        bar.id = 'hotbar';
        this.hotbarSlots = [];
        for (let i = 0; i < 9; i++) {
            const slot = document.createElement('div');
            slot.className = 'hotbar-slot';
            const label = document.createElement('span');
            label.className = 'slot-number';
            label.textContent = i + 1;
            slot.appendChild(label);
            const name = document.createElement('span');
            name.className = 'slot-name';
            slot.appendChild(name);
            bar.appendChild(slot);
            this.hotbarSlots.push({ slot, name, prevName: '', prevSelected: false });
        }
        this.container.appendChild(bar);
    }

    _createDebugInfo() {
        const debug = document.createElement('div');
        debug.id = 'debug-info';
        debug.innerHTML = `
            <div id="debug-fps">FPS: --</div>
            <div id="debug-pos">XYZ: --</div>
            <div id="debug-chunk">Chunk: --</div>
            <div id="debug-chunks">Chunks: --</div>
            <div id="debug-block">Looking at: --</div>
        `;
        this.container.appendChild(debug);
    }

    _createStartScreen() {
        const screen = document.createElement('div');
        screen.id = 'start-screen';
        screen.innerHTML = `
            <h1>MiniCraft 3D</h1>
            <p>Cliquez pour jouer</p>
            <div class="controls-info">
                <div><b>WASD</b> - Se d&eacute;placer</div>
                <div><b>Souris</b> - Regarder autour</div>
                <div><b>Clic gauche</b> - Casser un bloc</div>
                <div><b>Clic droit</b> - Poser un bloc</div>
                <div><b>Espace</b> - Sauter</div>
                <div><b>Molette / 1-9</b> - Changer de bloc</div>
                <div><b>F</b> - Mode vol</div>
                <div><b>Shift</b> - Sprint / Descendre (vol)</div>
                <div><b>F3</b> - Infos debug</div>
            </div>
        `;
        this.startScreen = screen;
        this.container.appendChild(screen);
    }

    hideStartScreen() { this.startScreen.style.display = 'none'; }
    showStartScreen() { this.startScreen.style.display = 'flex'; }

    updateHotbar(hotbar, selectedSlot) {
        // Only update slots that changed
        for (let i = 0; i < 9; i++) {
            const s = this.hotbarSlots[i];
            const isSelected = i === selectedSlot;
            if (s.prevSelected !== isSelected) {
                s.slot.className = 'hotbar-slot' + (isSelected ? ' selected' : '');
                s.prevSelected = isSelected;
            }
            const props = BlockProps[hotbar[i]];
            const name = props ? props.name : '';
            if (s.prevName !== name) { s.name.textContent = name; s.prevName = name; }
        }
    }

    updateDebug(fps, player, selectedBlock, chunkCount) {
        if (!this._debugVisible) return;

        // Throttle DOM writes to 10 updates/sec
        const now = performance.now();
        if (now - this._lastDebugUpdate < 100) return;
        this._lastDebugUpdate = now;

        this._dFps.textContent = `FPS: ${fps}`;
        this._dPos.textContent = `XYZ: ${player.position.x.toFixed(1)} / ${player.position.y.toFixed(1)} / ${player.position.z.toFixed(1)}`;
        this._dChunk.textContent = `Chunk: ${Math.floor(player.position.x / 16)}, ${Math.floor(player.position.z / 16)}`;
        this._dChunks.textContent = `Chunks: ${chunkCount}`;

        if (selectedBlock) {
            const p = BlockProps[selectedBlock.block];
            this._dBlock.textContent = `Looking at: ${p.name} (${selectedBlock.x}, ${selectedBlock.y}, ${selectedBlock.z})`;
        } else {
            this._dBlock.textContent = 'Looking at: --';
        }
    }

    toggleDebug() {
        this._debugVisible = !this._debugVisible;
        document.getElementById('debug-info').style.display = this._debugVisible ? 'block' : 'none';
    }
}
