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
    btnSpeaker: document.getElementById('btn-speaker')
};

const FIXED_TARGET_ID = 'nxdev_secured_admin_link_7x9q';

const state = {
    role: null, // 'target' or 'controller'
    peer: null,
    conn: null, // Data connection
    currentCall: null, // Media call
    targetStream: null,
    
    // Target state
    cameraActive: false,
    micActive: false,
    songObj: new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'),
    songPlaying: false,

    // Controller state
    controllerId: null,
    connectionInterval: null
};

// Initialize App Actions
const app = {
    selectRole(role) {
        state.role = role;
        // Map UI text based on new terminology
        if (role === 'target') {
            document.querySelector('#role-selection-screen h3').innerText = 'User Device';
        }
        
        this.switchScreen(role === 'target' ? UI.screens.target : UI.screens.controller);
        this.initPeer();
    },

    switchScreen(screenElement) {
        Object.values(UI.screens).forEach(s => {
            s.classList.remove('active');
            setTimeout(() => s.classList.add('hidden'), 300); // fade out
        });
        
        screenElement.classList.remove('hidden');
        setTimeout(() => screenElement.classList.add('active'), 50); // fade in
    },

    initPeer() {
        // Target uses fixed ID. Controller uses random ID.
        const internalId = state.role === 'target' 
            ? FIXED_TARGET_ID 
            : 'ctrl_' + Math.floor(Math.random() * 1000000);

        // Init PeerJS without own server (uses public generic server)
        state.peer = new Peer(internalId);

        state.peer.on('open', (peerId) => {
            if (state.role === 'target') {
                UI.targetStatus.innerText = "Online - Ready for Admin";
                document.querySelector('.status-indicator').classList.add('success');
                this.logToTarget("Device ready. Listening for Admin connection...");
            } else {
                state.controllerId = peerId;
                // Admin immediately starts auto-connecting to Target
                this.autoConnectToTarget();
            }
        });

        state.peer.on('error', (err) => {
            console.error(err);
            if (state.role === 'target') {
                if(err.type === 'unavailable-id') {
                    this.logToTarget("Error: Target is already running on another device or tab.", true);
                } else {
                    this.logToTarget("Error: " + err.type, true);
                }
            } else {
                if (err.type === 'peer-unavailable') {
                    let dots = UI.controllerStatus.innerText.match(/\./g);
                    let dotStr = (dots && dots.length < 3) ? '.'.repeat(dots.length + 1) : '.';
                    UI.controllerStatus.innerText = "User offline. Retrying" + dotStr;
                    setTimeout(() => { this.tryConnect(); }, 3000);
                } else {
                    UI.controllerStatus.innerText = "Connection error: " + err.type;
                }
            }
        });

        // If I am Target, listen for connections
        if (state.role === 'target') {
            state.peer.on('connection', (conn) => {
                this.logToTarget(`Admin connected securely.`);
                state.conn = conn;
                this.setupTargetConnection();
            });
        }

        // If I am Controller, listen for media calls from Target
        if (state.role === 'controller') {
            state.peer.on('call', (call) => {
                call.answer(); // Auto answer
                state.currentCall = call;
                
                call.on('stream', (remoteStream) => {
                    // Check if stream has video tracks
                    const hasVideo = remoteStream.getVideoTracks().length > 0;
                    
                    if (hasVideo) {
                        UI.remoteVideo.srcObject = remoteStream;
                        UI.remoteVideo.classList.remove('hidden');
                        UI.videoPlaceholder.classList.add('hidden');
                    } else {
                        // Only audio provided
                        UI.remoteAudio.srcObject = remoteStream;
                        UI.remoteVideo.classList.add('hidden');
                        UI.videoPlaceholder.classList.remove('hidden');
                        UI.videoPlaceholder.innerHTML = '<i class="ph ph-waveform"></i><p>Audio Streaming</p>';
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
            this.logToTarget(`Command received: ${data.cmd}`);
            this.processCommand(data);
        });

        state.conn.on('close', () => {
            this.logToTarget("Admin disconnected.", true);
            state.conn = null;
            this.stopAllMedia();
        });
    },

    async processCommand(data) {
        try {
            if (data.cmd === 'TOGGLE_CAMERA') {
                state.cameraActive = data.state;
                await this.updateMediaStream();
            } else if (data.cmd === 'TOGGLE_MIC') {
                state.micActive = data.state;
                await this.updateMediaStream();
            } else if (data.cmd === 'TOGGLE_SONG') {
                state.songPlaying = data.state;
                if (state.songPlaying) {
                    state.songObj.loop = true;
                    state.songObj.play().catch(e => this.logToTarget("Browser blocked autoplay.", true));
                    this.logToTarget("Playing song on speaker.");
                } else {
                    state.songObj.pause();
                    state.songObj.currentTime = 0;
                    this.logToTarget("Stopped song.");
                }
            }
        } catch (err) {
            this.logToTarget(`Command error: ${err.message}`, true);
        }
    },

    async updateMediaStream() {
        // Stop current tracks and call
        this.stopAllMedia();

        if (!state.cameraActive && !state.micActive) {
            return; // No media requested
        }

        try {
            // Get user media
            const constraints = {
                video: state.cameraActive ? { facingMode: "environment" } : false,
                audio: state.micActive
            };
            
            this.logToTarget("Opening camera/mic...");
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            state.targetStream = stream;
            
            // Call Controller
            if (state.conn && state.conn.peer) {
                this.logToTarget(`Sending stream to Admin...`);
                state.currentCall = state.peer.call(state.conn.peer, stream);
            }
        } catch (err) {
            this.logToTarget(`Media error: ${err.name} - ${err.message}`, true);
            // Inform controller of failure (optional via data conn)
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
        UI.controllerStatus.innerText = "Locating User Device...";
        this.tryConnect();
    },

    tryConnect() {
        if(state.conn) {
            state.conn.close();
        }

        state.conn = state.peer.connect(FIXED_TARGET_ID, {
            reliable: true
        });

        state.conn.on('open', () => {
            UI.connectionPanel.classList.add('hidden');
            UI.controlsPanel.classList.remove('hidden');
            let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            if(!isMobile) {
                // To help with browser autoplay policies on desktop
                document.body.addEventListener('click', () => {
                    UI.remoteVideo.play().catch(() => {});
                    UI.remoteAudio.play().catch(() => {});
                }, { once: true });
            }
        });

        state.conn.on('close', () => {
            alert("Target disconnected.");
            location.reload();
        });
        
        state.conn.on('error', (err) => {
            console.warn("Connection error", err);
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

    toggleRemoteMic() {
        const isActive = UI.btnMic.classList.toggle('active');
        if (isActive) {
            UI.btnMic.querySelector('span').innerText = 'Mute Mic';
            if(!UI.btnCamera.classList.contains('active')) {
                UI.videoPlaceholder.innerHTML = '<i class="ph ph-arrows-clockwise pulse"></i><p>Connecting Audio...</p>';
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
            UI.videoPlaceholder.innerHTML = '<i class="ph ph-arrows-clockwise pulse"></i><p>Connecting Stream...</p>';
        } else {
            UI.videoPlaceholder.innerHTML = '<i class="ph ph-video-camera-slash"></i><p>Camera is Offline</p>';
        }
    }
};
