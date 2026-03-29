// Nexus Remote Control - App Logic
const UI = {
    screens: {
        roleSelection: document.getElementById('role-selection-screen'),
        target: document.getElementById('target-screen'),
        controller: document.getElementById('controller-screen')
    },
    targetStatus: document.getElementById('target-status-text'),
    myPeerId: document.getElementById('my-peer-id'),
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
    targetIdInput: document.getElementById('target-id-input')
};

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
    controllerId: null
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
            setTimeout(() => s.classList.add('hidden'), 300); // fade out
        });
        
        screenElement.classList.remove('hidden');
        setTimeout(() => screenElement.classList.add('active'), 50); // fade in
    },

    initPeer() {
        // Generate a simple 6-digit code for user, but prefix it internally for uniqueness on the global PeerJS server
        const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
        const internalId = state.role === 'target' 
            ? 'nxdev_' + randomCode 
            : 'ctrl_' + Math.floor(Math.random() * 1000000);
            
        // Save the display code for the user
        state.displayCode = state.role === 'target' ? randomCode : null;

        // Init PeerJS without own server (uses public generic server)
        state.peer = new Peer(internalId);

        state.peer.on('open', (peerId) => {
            if (state.role === 'target') {
                // Show only the 6-digit easy code to the user
                UI.myPeerId.innerText = state.displayCode;
                UI.targetStatus.innerText = "Online and Waiting...";
                document.querySelector('.status-indicator').classList.add('success');
                this.logToTarget("Device ready. Waiting for Controller...");
            } else {
                state.controllerId = peerId;
            }
        });

        state.peer.on('error', (err) => {
            console.error(err);
            if (state.role === 'target') {
                this.logToTarget("Error: " + err.type, true);
            } else {
                UI.controllerStatus.innerText = "Connection error: " + err.type;
            }
        });

        // If I am Target, listen for connections
        if (state.role === 'target') {
            state.peer.on('connection', (conn) => {
                this.logToTarget(`Controller connected: ${conn.peer}`);
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

    copyId() {
        navigator.clipboard.writeText(UI.myPeerId.innerText);
        this.logToTarget("ID copied to clipboard.");
    },

    setupTargetConnection() {
        state.conn.on('data', (data) => {
            this.logToTarget(`Received command: ${data.cmd}`);
            this.processCommand(data);
        });

        state.conn.on('close', () => {
            this.logToTarget("Controller disconnected.", true);
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
            
            this.logToTarget("Requesting hardware access...");
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            state.targetStream = stream;
            
            // Call Controller
            if (state.conn && state.conn.peer) {
                this.logToTarget(`Calling controller to send stream...`);
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
    connectToTarget() {
        const targetId = UI.targetIdInput.value.trim();
        if (!targetId) {
            UI.controllerStatus.innerText = "Please enter an ID";
            return;
        }

        const btn = document.getElementById('connect-btn');
        btn.innerHTML = 'Connecting...';
        btn.disabled = true;

        const internalTargetId = 'nxdev_' + targetId;
        state.conn = state.peer.connect(internalTargetId);

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

        state.conn.on('error', (err) => {
            UI.controllerStatus.innerText = "Connection failed.";
            btn.innerHTML = 'Connect <i class="ph ph-link"></i>';
            btn.disabled = false;
        });

        state.conn.on('close', () => {
            alert("Target disconnected.");
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
