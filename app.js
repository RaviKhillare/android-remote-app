// Nexus Remote Control - App Logic
const UI = {
    screens: {
        roleSelection: document.getElementById('role-selection-screen'),
        target: document.getElementById('target-screen'),
        controller: document.getElementById('controller-screen')
    },
    targetStatus: document.getElementById('target-status-text'),
    targetLogs: document.getElementById('target-logs'),
    controllerStatus: document.getElementById('controller-status'),
    controlsPanel: document.getElementById('controls-panel'),
    connectionPanel: document.getElementById('connection-panel'),
    videoPlaceholder: document.getElementById('video-placeholder'),
    remoteVideo: document.getElementById('remote-video'),
    remoteAudio: document.getElementById('remote-audio'),
    btnCamera: document.getElementById('btn-camera'),
    btnMic: document.getElementById('btn-mic'),
    btnSpeaker: document.getElementById('btn-speaker'),
    btnSwitch: document.getElementById('btn-switch'),
    connProgress: document.getElementById('conn-progress'),
    roomDisplay: document.getElementById('room-display')
};

// Privacy & Room Logic: Get room from URL query or default to 'public'
const urlParams = new URLSearchParams(window.location.search);
const ROOM_NAME = urlParams.get('room') || 'public';
const FIXED_TARGET_ID = `nxdev_room_${ROOM_NAME}_target`;

UI.roomDisplay.innerText = `Room: ${ROOM_NAME}`;

const state = {
    role: null,
    peer: null,
    conn: null,
    currentCall: null,
    targetStream: null,
    
    // Target state
    cameraActive: false,
    cameraFacingMode: 'environment', // Start with back camera
    micActive: false,
    songObj: new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'),
    songPlaying: false,

    // Controller state
    controllerId: null,
    progressVal: 0,
    progressInterval: null
};

// Initialize App Actions
const app = {
    selectRole(role) {
        state.role = role;
        this.switchScreen(role === 'target' ? UI.screens.target : UI.screens.controller);
        this.initPeer();
    },

    switchScreen(screenElement) {
        Object.values(UI.screens).forEach(s => {
            s.classList.remove('active');
            // After fade out (300ms), hide only if it's not the new active screen
            setTimeout(() => {
                if (!s.classList.contains('active')) {
                    s.classList.add('hidden');
                }
            }, 310);
        });
        
        screenElement.classList.remove('hidden');
        // Small delay to ensure browser paints 'hidden' removal before starting 'active' transition
        setTimeout(() => screenElement.classList.add('active'), 20);
    },

    initPeer() {
        const internalId = state.role === 'target' 
            ? FIXED_TARGET_ID 
            : `ctrl_${ROOM_NAME}_${Math.floor(Math.random() * 100000)}`;

        const peerConfig = {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun.voiparound.com' }
                ]
            }
        };

        state.peer = new Peer(internalId, peerConfig);

        state.peer.on('open', (peerId) => {
            if (state.role === 'target') {
                UI.targetStatus.innerText = "Online - Ready for Admin";
                document.querySelector('.status-indicator').classList.add('success');
                this.logToTarget(`Room [${ROOM_NAME}] active. Ready.`);
            } else {
                state.controllerId = peerId;
                this.autoConnectToTarget();
            }
        });

        state.peer.on('error', (err) => {
            console.error(err);
            if (state.role === 'target') {
                if(err.type === 'unavailable-id') {
                    this.logToTarget("Error: This room is already being used on another device.", true);
                    document.getElementById('target-main-msg').innerText = "Room Occupied";
                } else {
                    this.logToTarget("Error: " + err.type, true);
                }
            } else {
                if (err.type === 'peer-unavailable') {
                    UI.controllerStatus.innerText = "Target Offline. Searching...";
                    setTimeout(() => { this.tryConnect(); }, 1200);
                } else {
                    UI.controllerStatus.innerText = "Link Error: " + err.type;
                }
            }
        });

        if (state.role === 'target') {
            state.peer.on('connection', (conn) => {
                this.logToTarget("Admin joined the room.");
                state.conn = conn;
                this.setupTargetConnection();
            });
        }

        if (state.role === 'controller') {
            state.peer.on('call', (call) => {
                call.answer();
                state.currentCall = call;
                
                call.on('stream', (remoteStream) => {
                    const hasVideo = remoteStream.getVideoTracks().length > 0;
                    if (hasVideo) {
                        UI.remoteVideo.srcObject = remoteStream;
                        UI.remoteVideo.classList.remove('hidden');
                        UI.videoPlaceholder.classList.add('hidden');
                    } else {
                        UI.remoteAudio.srcObject = remoteStream;
                        UI.remoteVideo.classList.add('hidden');
                        UI.videoPlaceholder.classList.remove('hidden');
                        UI.videoPlaceholder.innerHTML = '<i class="ph ph-waveform spinner"></i><p>Receiving Audio...</p>';
                    }
                });

                call.on('close', () => {
                   this.resetControllerMediaViewer();
                });
            });
        }
    },

    // ======== TARGET LOGIC ========
    logToTarget(msg, isError = false) {
        const li = document.createElement('li');
        li.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        if (isError) li.classList.add('error');
        UI.targetLogs.appendChild(li);
        UI.targetLogs.parentElement.scrollTop = UI.targetLogs.parentElement.scrollHeight;
    },

    setupTargetConnection() {
        state.conn.on('data', (data) => {
            this.logToTarget(`Received: ${data.cmd}`);
            this.processCommand(data);
        });

        state.conn.on('close', () => {
            this.logToTarget("Admin left.", true);
            state.conn = null;
            this.stopAllMedia();
        });
    },

    async processCommand(data) {
        try {
            if (data.cmd === 'TOGGLE_CAMERA') {
                state.cameraActive = data.state;
                await this.updateMediaStream();
            } else if (data.cmd === 'SWITCH_CAMERA') {
                state.cameraFacingMode = state.cameraFacingMode === 'environment' ? 'user' : 'environment';
                if (state.cameraActive) await this.updateMediaStream();
            } else if (data.cmd === 'TOGGLE_MIC') {
                state.micActive = data.state;
                await this.updateMediaStream();
            } else if (data.cmd === 'TOGGLE_SONG') {
                state.songPlaying = data.state;
                if (state.songPlaying) {
                    state.songObj.loop = true;
                    state.songObj.play().catch(e => this.logToTarget("Autoplay blocked.", true));
                    this.logToTarget("Loudspeaker: Playing...");
                } else {
                    state.songObj.pause();
                    state.songObj.currentTime = 0;
                    this.logToTarget("Loudspeaker: Off.");
                }
            }
        } catch (err) {
            this.logToTarget(`Cmd Exception: ${err.message}`, true);
        }
    },

    async updateMediaStream() {
        // Optimization: Don't stop all tracks, just update permissions and re-trigger call
        if (!state.cameraActive && !state.micActive) {
            this.stopAllMedia();
            return;
        }

        try {
            const constraints = {
                video: state.cameraActive ? { facingMode: state.cameraFacingMode } : false,
                audio: state.micActive
            };
            
            // Re-use current stream if possible to avoid hardware re-initialization delay
            if (!state.targetStream) {
                this.logToTarget("Warming up Hardware...");
                state.targetStream = await navigator.mediaDevices.getUserMedia(constraints);
            } else {
                // If it exists, update it or get new tracks if one is missing
                const hasVideo = state.targetStream.getVideoTracks().length > 0;
                const hasAudio = state.targetStream.getAudioTracks().length > 0;

                if ((state.cameraActive && !hasVideo) || (state.micActive && !hasAudio)) {
                    this.logToTarget("Accessing missing hardware...");
                    const freshStream = await navigator.mediaDevices.getUserMedia(constraints);
                    // Combine or replace (simplified: just replace for now)
                    state.targetStream.getTracks().forEach(t => t.stop());
                    state.targetStream = freshStream;
                } else {
                    // Just enable/disable existing tracks
                    state.targetStream.getVideoTracks().forEach(t => t.enabled = state.cameraActive);
                    state.targetStream.getAudioTracks().forEach(t => t.enabled = state.micActive);
                }
            }
            
            if (state.conn && state.conn.peer) {
                this.logToTarget("Instant Streaming Active.");
                // PeerJS call should be refreshed with the new stream config
                if (state.currentCall) state.currentCall.close();
                state.currentCall = state.peer.call(state.conn.peer, state.targetStream);
            }
        } catch (err) {
            this.logToTarget(`Hardware Error: ${err.name}`, true);
        }
    },

    stopAllMedia() {
        if (state.targetStream) {
            state.targetStream.getTracks().forEach(track => track.stop());
            state.targetStream = null;
        }
        if (state.currentCall) {
            state.currentCall.close();
            state.currentCall = null;
        }
    },

    // ======== CONTROLLER LOGIC ========
    autoConnectToTarget() {
        UI.controllerStatus.innerText = "Initializing Peer Network...";
        this.updateProgress(15);
        this.tryConnect();
    },

    updateProgress(val) {
        state.progressVal = val;
        UI.connProgress.style.width = val + '%';
    },

    tryConnect() {
        if(state.conn) state.conn.close();
        
        UI.controllerStatus.innerText = "Searching for Target Device...";
        this.updateProgress(state.progressVal + 20);
        
        state.conn = state.peer.connect(FIXED_TARGET_ID, { reliable: true });

        state.conn.on('open', () => {
            this.updateProgress(100);
            setTimeout(() => {
                UI.connectionPanel.classList.add('hidden');
                UI.controlsPanel.classList.remove('hidden');
            }, 300);
            
            let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            if(!isMobile) {
                document.body.addEventListener('click', () => {
                    UI.remoteVideo.play().catch(() => {});
                    UI.remoteAudio.play().catch(() => {});
                }, { once: true });
            }
        });

        state.conn.on('close', () => {
            alert("Connection Lost.");
            location.reload();
        });
    },

    sendCommand(cmd, stateValue) {
        if (state.conn && state.conn.open) {
            state.conn.send({ cmd: cmd, state: stateValue });
        }
    },

    toggleRemoteCamera() {
        const isActive = UI.btnCamera.classList.toggle('active');
        if (isActive) {
            UI.btnCamera.querySelector('span').innerText = 'Stop Camera';
            this.resetControllerMediaViewer(true);
        } else {
            UI.btnCamera.querySelector('span').innerText = 'View Camera';
            this.resetControllerMediaViewer();
        }
        this.sendCommand('TOGGLE_CAMERA', isActive);
    },

    switchRemoteCamera() {
        UI.btnSwitch.classList.add('active');
        setTimeout(() => UI.btnSwitch.classList.remove('active'), 1000);
        this.sendCommand('SWITCH_CAMERA', true);
    },

    toggleRemoteMic() {
        const isActive = UI.btnMic.classList.toggle('active');
        if (isActive) {
            UI.btnMic.querySelector('span').innerText = 'Mute Mic';
            if(!UI.btnCamera.classList.contains('active')) {
                UI.videoPlaceholder.innerHTML = '<i class="ph ph-arrows-clockwise spinner"></i><p>Establishing Mic...</p>';
            }
        } else {
            UI.btnMic.querySelector('span').innerText = 'Listen Mic';
        }
        this.sendCommand('TOGGLE_MIC', isActive);
    },

    playRemoteSong() {
        const isActive = UI.btnSpeaker.classList.toggle('active');
        if (isActive) {
            UI.btnSpeaker.querySelector('span').innerText = 'Stop Song';
        } else {
            UI.btnSpeaker.querySelector('span').innerText = 'Play Song';
        }
        this.sendCommand('TOGGLE_SONG', isActive);
    },

    resetControllerMediaViewer(isConnecting = false) {
        UI.remoteVideo.srcObject = null;
        UI.remoteAudio.srcObject = null;
        UI.remoteVideo.classList.add('hidden');
        UI.videoPlaceholder.classList.remove('hidden');
        
        if (isConnecting) {
            UI.videoPlaceholder.innerHTML = '<i class="ph ph-circle-notch spinner"></i><p>Opening Camera...</p>';
        } else {
            UI.videoPlaceholder.innerHTML = '<i class="ph ph-video-camera-slash"></i><p>Stream Closed</p>';
        }
    }
};

