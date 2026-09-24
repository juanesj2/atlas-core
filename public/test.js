
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let ws = null;
        let wsReconnectTimer = null;
        let wsMessageQueue = [];
        let thinkingTimeoutTimer = null;

        function connectWebSocket() {
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                return;
            }
            clearTimeout(wsReconnectTimer);
            try {
                ws = new WebSocket(`${protocol}//${window.location.host}`);
                ws.binaryType = 'arraybuffer';

                ws.onopen = () => {
                    console.log('✅ Conectado al Gateway de Cronos');
                    while (wsMessageQueue.length > 0) {
                        const queued = wsMessageQueue.shift();
                        try {
                            const dataStr = (typeof queued === 'object') ? JSON.stringify(queued) : queued;
                            ws.send(dataStr);
                        } catch (err) {
                            console.error("[WS Queue] Error enviando mensaje en cola:", err);
                        }
                    }
                };

                ws.onmessage = handleWsMessage;

                ws.onclose = (event) => {
                    console.warn(`[WS] Desconectado de Cronos (código: ${event.code}). Reconectando en 1.5s...`);
                    clearThinkingTimeout();
                    if (stateText && (stateText.innerText === 'PENSANDO' || (screen && screen.classList.contains('state-thinking')))) {
                        updateStateUI('IDLE');
                    }
                    scheduleWsReconnect();
                };

                ws.onerror = (err) => {
                    console.error('[WS] Error en conexión WebSocket:', err);
                    try { ws.close(); } catch(e) {}
                };
            } catch (err) {
                console.error('[WS] Fallo al inicializar WebSocket:', err);
                scheduleWsReconnect();
            }
        }

        function scheduleWsReconnect() {
            clearTimeout(wsReconnectTimer);
            wsReconnectTimer = setTimeout(() => {
                connectWebSocket();
            }, 1500);
        }

        function safeSendWs(payload) {
            const dataStr = (typeof payload === 'object') ? JSON.stringify(payload) : payload;
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(dataStr);
                    return true;
                } catch (e) {
                    console.error("[WS] Error en send():", e);
                }
            }
            console.log("[WS] Socket no abierto. Guardando en cola y reconectando...");
            wsMessageQueue.push(payload);
            connectWebSocket();
            return false;
        }

        function startThinkingTimeout() {
            clearThinkingTimeout();
            thinkingTimeoutTimer = setTimeout(() => {
                if (stateText && (stateText.innerText === 'PENSANDO' || (screen && screen.classList.contains('state-thinking')))) {
                    console.warn("[Timeout] Cronos tardó en responder. Reanudando estado.");
                    updateStateUI('IDLE');
                    appendMessage('Cronos', '⚠️ No se recibió respuesta a tiempo del servidor. Comprueba la conexión.');
                }
            }, 25000);
        }

        function clearThinkingTimeout() {
            if (thinkingTimeoutTimer) {
                clearTimeout(thinkingTimeoutTimer);
                thinkingTimeoutTimer = null;
            }
        }

        // Conectar inmediatamente el socket
        connectWebSocket();

        const screen = document.getElementById('screen');
        const stateText = document.getElementById('stateText');
        const lottiePlayer = document.getElementById('CronosLottie');
        const chatBox = document.getElementById('chatBox');
        const input = document.getElementById('commandInput');
        const micButton = document.getElementById('micButton');
        const voiceSelect = document.getElementById('voiceSelect');
        const identityInput = document.getElementById('identityInput');

        // Diccionario de traducción de estados para la interfaz en español
        const STATE_LABELS_ES = {
            'IDLE': 'REPOSO',
            'LISTENING': 'ESCUCHANDO',
            'THINKING': 'PENSANDO',
            'SPEAKING': 'HABLANDO'
        };

        function updateStateUI(state) {
            const upper = state.toUpperCase();
            stateText.innerText = STATE_LABELS_ES[upper] || upper;
            screen.className = 'screen-container state-' + state.toLowerCase();
        }

        let isRecording = false;
        let currentAudio = null;
        let expectResponse = false;
        let isAwaitingCommand = false;
        let commandTimeout = null;
        let wakeWordListening = true;
        let micBlocked = false;

        // Sonido sintético sci-fi de confirmación cuando se detecta la palabra "Cronos" (0ms latencia)
        function playWakeChime() {
            try {
                const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtxClass) return;
                const audioCtx = new AudioCtxClass();
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
                const now = audioCtx.currentTime;
                
                // Tono 1: 587.33 Hz (Re5)
                const osc1 = audioCtx.createOscillator();
                const gain1 = audioCtx.createGain();
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(587.33, now);
                gain1.gain.setValueAtTime(0.12, now);
                gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
                osc1.connect(gain1);
                gain1.connect(audioCtx.destination);
                osc1.start(now);
                osc1.stop(now + 0.22);

                // Tono 2: 880 Hz (La5)
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(880, now + 0.09);
                gain2.gain.setValueAtTime(0.15, now + 0.09);
                gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
                osc2.connect(gain2);
                gain2.connect(audioCtx.destination);
                osc2.start(now + 0.09);
                osc2.stop(now + 0.38);
            } catch (e) {
                console.warn("[Chime] Error emitiendo tono:", e);
            }
        }
        
        // --- SPEECH RECOGNITION (STT Nativo del navegador) ---
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        let recognition = null;
        let lastCronosSpokenText = '';
        let audioJustEndedTimestamp = 0;
        let isAudioPaused = false;
        let pauseResumeTimeout = null;
        let speechSilenceTimer = null;
        let isEnrollRecordingActive = false;

        function showMicPermissionHelp() {
            appendMessage('Cronos', `
                <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 12px; padding: 14px 16px; margin: 6px 0;">
                    <b style="color: #fca5a5; display: flex; align-items: center; gap: 8px; font-size: 14px;">
                        🔒 Permiso de micrófono bloqueado en el navegador
                    </b>
                    <p style="margin: 6px 0 8px 0; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
                        Tu navegador tiene bloqueado el acceso al micrófono para esta página. Para desbloquearlo en 5 segundos:
                    </p>
                    <ol style="margin: 0; padding-left: 18px; font-size: 12px; color: #94a3b8; line-height: 1.7;">
                        <li>Haz clic en el <b>icono del candado 🔒</b> o <b>ajustes del sitio ⚙️</b> a la izquierda de la barra de direcciones URL.</li>
                        <li>Busca la opción <b>Micrófono</b> y cámbiala a <b>Permitir</b> (o haz clic en "Restablecer permisos").</li>
                        <li>Recarga la página (<b>F5</b>) y vuelve a pulsar el botón 🎙️.</li>
                    </ol>
                </div>
            `);
        }

        let micBannerDismissTimeout = null;

        function showMicBanner(htmlContent, borderColor, autoDismissSeconds = 5) {
            const banner = document.getElementById('micPromptBanner');
            const content = document.getElementById('micPromptContent');
            if (!banner || !content) return;

            clearTimeout(micBannerDismissTimeout);
            content.innerHTML = htmlContent;
            banner.style.borderColor = borderColor || 'rgba(0, 229, 255, 0.6)';
            banner.style.display = 'flex';

            // Forzar reflow para animación CSS fluida
            void banner.offsetWidth;
            banner.classList.remove('hidden');
            banner.classList.add('visible');

            if (autoDismissSeconds > 0) {
                micBannerDismissTimeout = setTimeout(() => {
                    hideMicBanner();
                }, autoDismissSeconds * 1000);
            }
        }

        function hideMicBanner() {
            const banner = document.getElementById('micPromptBanner');
            if (!banner) return;
            clearTimeout(micBannerDismissTimeout);
            banner.classList.remove('visible');
            banner.classList.add('hidden');
            setTimeout(() => {
                if (banner.classList.contains('hidden')) {
                    banner.style.display = 'none';
                }
            }, 500);
        }

        function checkMicEnvironment() {
            // 1. Si no es contexto seguro (HTTP en móvil)
            if (!window.isSecureContext) {
                showMicBanner(`
                    <span>🔒 <b>Micrófono bloqueado:</b> En el móvil debes entrar por <b>HTTPS</b> para que el navegador te pida permiso.</span>
                    <button onclick="window.location.href='https://' + window.location.hostname + ':8443'" class="glass-btn" style="padding: 6px 14px; font-size: 12px; background: rgba(0,229,255,0.25); border-color: #00e5ff; color: #00e5ff; margin-left: 5px;">
                        Entrar por HTTPS (Puerto 8443) ➔
                    </button>
                `, 'rgba(239, 68, 68, 0.7)', 5);
                return;
            }

            // 2. Si es HTTPS, comprobar el estado de permisos
            if (navigator.permissions && navigator.permissions.query) {
                navigator.permissions.query({ name: 'microphone' }).then(status => {
                    if (status.state === 'prompt') {
                        showMicBanner(`
                            <span>🎙️ <b>Toca el núcleo de Cronos</b> para activar el micrófono y el comando de voz "Cronos".</span>
                        `, 'rgba(0, 229, 255, 0.6)', 5);
                    } else if (status.state === 'denied') {
                        showMicBanner(`
                            <span>🔒 Micrófono bloqueado en este sitio. Toca el candado 🔒 en la barra de direcciones y selecciona "Permitir".</span>
                        `, 'rgba(239, 68, 68, 0.7)', 5);
                    } else if (status.state === 'granted') {
                        hideMicBanner();
                    }

                    status.onchange = () => checkMicEnvironment();
                }).catch(() => {});
            }
        }

        function ensureAudioContext() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 16000
                });
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
        }

        window.hasMicPermission = false;
        async function ensureMicPermission() {
            if (window.hasMicPermission) return true;

            // 1. Detección de contexto seguro (HTTPS o localhost)
            if (!window.isSecureContext) {
                checkMicEnvironment();
                showMicPermissionHelp();
                return false;
            }

            // 2. Comprobar permisos con Permissions API si está soportado
            if (navigator.permissions && navigator.permissions.query) {
                try {
                    const status = await navigator.permissions.query({ name: 'microphone' });
                    if (status.state === 'denied') {
                        showMicPermissionHelp();
                        checkMicEnvironment();
                        return false;
                    }
                    if (status.state === 'granted') {
                        window.hasMicPermission = true;
                        hideMicBanner();
                        return true;
                    }
                } catch (e) {}
            }

            // 3. Forzar el diálogo nativo de permisos del navegador usando getUserMedia
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach(track => track.stop());
                    hideMicBanner();
                    window.hasMicPermission = true;
                    return true;
                } catch (err) {
                    console.error("Permiso denegado por getUserMedia:", err);
                    showMicPermissionHelp();
                    checkMicEnvironment();
                    return false;
                }
            }
            
            showMicPermissionHelp();
            return false;
        }

        function isVoiceEnrollmentRequest(text) {
            if (!text) return false;
            const clean = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ");
            return /\b(registra|registro|registres|registrame|registrar|aprende|aprendo|aprendeme|aprender|guarda|guardo|guardar|memoriza|memorizo|memorizar|graba|grabo|grabar|calibra|calibro|calibrar)\b.*\b(voz|huella|timbre|audio|perfil)\b/i.test(clean) ||
                   /\b(registrame|registro mi voz|registra mi voz|aprende mi voz|graba mi voz|memoriza mi voz|guardar mi voz|aprender mi voz|calibra mi voz)\b/i.test(clean);
        }

        function sendUserVoiceCommand(text) {
            if (!text || !text.trim()) return;
            appendMessage('user', text);

            if (isVoiceEnrollmentRequest(text)) {
                console.log("[Voice] 🎙️ Petición de registro de voz detectada directamente por voz:", text);
                updateStateUI('SPEAKING');
                let user = (identityInput && identityInput.value.trim()) || 'Juanes';
                if (!user || user.toLowerCase() === 'invitado') user = 'Juanes';
                appendMessage('Cronos', `¡Entendido! Iniciando el registro de tu huella de voz para <b>${user}</b>. Prepárate para hablar.`);
                if ('speechSynthesis' in window) {
                    try {
                        window.speechSynthesis.cancel();
                        const utt = new SpeechSynthesisUtterance("Abriendo calibrador biométrico. Prepárate para hablar.");
                        utt.lang = 'es-ES';
                        window.speechSynthesis.speak(utt);
                    } catch(e) {}
                }
                triggerVoiceEnrollmentFlow(user);
                return;
            }

            const currentIdentity = (identityInput && identityInput.value.trim()) || localStorage.getItem('Cronos_user_identity') || 'Juanes';
            updateStateUI('THINKING');
            startThinkingTimeout();
            safeSendWs({ 
                event: 'TEXT_COMMAND', 
                text: text.trim(),
                voice: voiceSelect.value,
                identity: currentIdentity,
                isSpoken: true
            });
        }

        // Normalizador fonético que elimina tildes (átlas -> Cronos) para que Google STT nunca falle
        // Exigimos siempre un saludo por delante para evitar el falso positivo de "Cronos" suelto
        const WAKE_WORD_REGEX = /^(?:oye|olle|oie|hola|ey|hey|eh|ei|ok|okay|mira|dime)[\s,.:;?¿!¡]+(?:Cronos|atla|adlas|Cronoss|atlad|adla|aplas|atras)\b[\s,.:;?¿!¡-]*(.*)$/i;

        function normalizeWakeText(text) {
            if (!text) return '';
            return text.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // átlas -> Cronos
                .trim(); // No quitamos signos aquí porque la regex ya los contempla
        }

        function hasWakeWord(text) {
            if (!text) return false;
            const clean = normalizeWakeText(text);
            return WAKE_WORD_REGEX.test(clean);
        }

        function matchWakeWord(text) {
            if (!text) return null;
            const clean = normalizeWakeText(text);
            return clean.match(WAKE_WORD_REGEX) || null;
        }

        function removeWakeWord(text) {
            if (!text) return '';
            const clean = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return clean
                .replace(/^(?:oye|olle|oie|hola|ey|hey|eh|ei|ok|okay|mira|dime)[\s,.:;?¿!¡]+(?:Cronos|atla|adlas|Cronoss|atlad|adla|aplas|atras)\b[\s,.:;?¿!¡-]*/gi, '')
                .trim();
        }

        function isStopPhrase(text) {
            if (!text) return false;
            const clean = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").trim();
            if (!clean) return false;

            // 1. Órdenes unívocas de parada (calla, cállate, silencio, stop, basta, detente, cancélalo...)
            if (/\b(calla|callate|silencio|stop|basta|alto|detente|cancela|parate|paralo|parale|dejalo|ya no)\b/i.test(clean)) {
                const words = clean.split(/\s+/).filter(w => w.length > 0);
                if (words.length <= 3) return true;
            }

            // 2. Para la palabra "para": SOLO se considera orden si se dice aislada o en fórmulas directas ("para ya", "Cronos para", "para por favor")
            // Esto garantiza al 100% que si Cronos dice la preposición "para" en una frase ("para ti", "medida para reducir"), JAMÁS se pare a sí mismo.
            const isExplicitStopPara = /^(?:(?:Cronos|oye\s+Cronos|hola\s+Cronos|por\s+favor)\s+)?para(?:\s+(?:ya|Cronos|por\s+favor|un\s+momento))?$/i.test(clean);
            if (isExplicitStopPara) {
                return true;
            }

            return false;
        }

        function isResumePhrase(text) {
            if (!text) return false;
            const clean = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").trim();
            return /\b(continua|continuar|sigue|siguelo|prosigue|adelante|dale|sigue hablando|continua hablando)\b/i.test(clean);
        }

        // Filtro estricto para evitar que las palabras leídas por el altavoz de Cronos se cuelen como comandos del usuario
        function isSpokenTextEcho(text) {
            if (!text || !lastCronosSpokenText) return false;
            const cleanUser = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").trim();
            if (!cleanUser || cleanUser.length < 2) return false;

            // ¡CRÍTICO! Si contiene la palabra de activación de Cronos, NUNCA es eco
            // porque Cronos tiene terminantemente prohibido pronunciar su propio nombre.
            if (hasWakeWord(cleanUser)) {
                return false;
            }

            // ¡CRÍTICO! Si el usuario está diciendo una orden de parada ("para", "para ya", "cállate", "stop", "silencio")
            // NUNCA es eco, es una orden directa del usuario.
            if (isStopPhrase(cleanUser)) {
                return false;
            }

            const cleanCronos = lastCronosSpokenText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ");
            const words = cleanUser.split(/\s+/).filter(w => w.length > 0);
            
            // El eco acústico del altavoz siempre captura frases de al menos 3 palabras
            if (words.length >= 3) {
                if (cleanCronos.includes(cleanUser)) return true;
                const matchCount = words.filter(w => w.length > 2 && cleanCronos.includes(w)).length;
                if (matchCount / words.length >= 0.6) {
                    return true;
                }
            }

            return false;
        }

        function ensureRecognitionRunning() {
            if (!recognition || micBlocked || !wakeWordListening || isEnrollRecordingActive) return;
            try {
                recognition.start();
            } catch (err) {
                if (err.name !== 'InvalidStateError') {
                    setTimeout(() => {
                        if (wakeWordListening && !micBlocked && !isEnrollRecordingActive) {
                            try { recognition.start(); } catch (e) {}
                        }
                    }, 350);
                }
            }
        }

        function dispatchVoiceCommand(cmd) {
            if (!cmd || !cmd.trim()) return;
            clearTimeout(speechSilenceTimer);
            speechSilenceTimer = null;
            clearTimeout(commandTimeout);
            isAwaitingCommand = false;

            // Purgar inmediatamente el búfer del micro para reiniciar el reconocedor sin acumulación
            if (recognition) {
                try { recognition.abort(); } catch (e) {}
            }
            setTimeout(() => ensureRecognitionRunning(), 150);

            sendUserVoiceCommand(cmd.trim());
        }

        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.lang = 'es-ES';
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.maxAlternatives = 1;

            recognition.onstart = () => {
                isRecording = true;
                micButton.classList.add('recording');
                const mobileMic = document.getElementById('mobileMainMicBtn');
                if (mobileMic) mobileMic.classList.add('recording');
            };

            recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const item = event.results[i];
                    const piece = item[0].transcript.toLowerCase();
                    if (item.isFinal) {
                        finalTranscript += piece + ' ';
                    } else {
                        interimTranscript += piece + ' ';
                    }
                }

                const currentText = (finalTranscript || interimTranscript).trim();
                if (!currentText) return;

                console.log("[STT Mic]:", currentText);
                const debugEl = document.getElementById('sttDebug');
                if (debugEl) {
                    debugEl.innerText = 'Escuchando: ' + currentText;
                    clearTimeout(window.sttDebugTimeout);
                    window.sttDebugTimeout = setTimeout(() => { debugEl.innerText = ''; }, 4000);
                }

                // 0. CANCELACIÓN MIENTRAS PIENSA
                if (screen.classList.contains('state-thinking') || stateText.innerText === 'PENSANDO') {
                    const cleanWithoutWake = removeWakeWord(currentText);
                    if (isStopPhrase(currentText) || isStopPhrase(cleanWithoutWake)) {
                        console.log("[Thinking] 🛑 Cancelación por voz mientras pensaba:", currentText);
                        updateStateUI('IDLE');
                        isAwaitingCommand = false;
                        clearTimeout(speechSilenceTimer);
                        clearThinkingTimeout();
                        safeSendWs({ event: 'STOP_SPEAKING' });
                        if (recognition) {
                            try { recognition.abort(); } catch (e) {}
                        }
                        setTimeout(() => ensureRecognitionRunning(), 150);
                        appendMessage('user', `🛑 (Cancelado: "${currentText}")`);
                        return;
                    }
                }

                // 1. CONTROL POR VOZ MIENTRAS Cronos HABLA (Barge-in / Pausa / Parada)
                if (currentAudio && !currentAudio.paused) {
                    const containsWake = hasWakeWord(currentText);

                    // Si el usuario pronuncia la palabra de activación 'Cronos':
                    // Cronos NUNCA dice "Cronos", por lo que esta palabra proviene con 100% de certeza del usuario.
                    // Debe procesarse SIEMPRE antes que el filtro de eco.
                    if (containsWake) {
                        const cleanWithoutWake = removeWakeWord(currentText);

                        // Comprobar si además de "Cronos" dijo una orden de parada inmediata:
                        // "Cronos para", "Cronos cállate", "Cronos stop", "Cronos silencio", "Cronos cancela", etc.
                        const hasStopWord = /\b(para|parar|ya|calla|callate|silencio|stop|basta|alto|detente|cancela|dejalo)\b/i.test(cleanWithoutWake) ||
                                            isStopPhrase(currentText) ||
                                            isStopPhrase(cleanWithoutWake);

                        if (hasStopWord) {
                            console.log("[Barge-in] 🛑 ¡Parada por voz con 'Cronos' detectada! Cortando audio:", currentText);
                            clearTimeout(pauseResumeTimeout);
                            clearTimeout(speechSilenceTimer);
                            currentAudio.pause();
                            currentAudio.currentTime = 0;
                            currentAudio = null;
                            isAudioPaused = false;
                            audioJustEndedTimestamp = Date.now();
                            updateStateUI('IDLE');
                            appendMessage('user', `🛑 (Detenido: "${currentText}")`);
                            clearThinkingTimeout();
                            safeSendWs({ event: 'STOP_SPEAKING' });
                            if (recognition) {
                                try { recognition.abort(); } catch (e) {}
                            }
                            setTimeout(() => ensureRecognitionRunning(), 150);
                            return;
                        }

                        // Si dijo "Cronos" sin orden de parada inmediata (ej: "Cronos", "Oye Cronos", "Cronos espera" o comenzó una nueva orden):
                        // Pausamos la voz de Cronos al instante para que la habitación quede en silencio y nos escuche con nitidez.
                        console.log("[Barge-in] ⏸️ 'Cronos' escuchado durante la locución. Pausando audio:", currentText);
                        clearTimeout(pauseResumeTimeout);
                        clearTimeout(speechSilenceTimer);
                        currentAudio.pause();
                        isAudioPaused = true;

                        if (recognition) {
                            try { recognition.abort(); } catch (e) {}
                        }
                        setTimeout(() => ensureRecognitionRunning(), 150);

                        playWakeChime();
                        updateStateUI('LISTENING');
                        isAwaitingCommand = true;

                        pauseResumeTimeout = setTimeout(() => {
                            if (isAudioPaused && currentAudio) {
                                console.log("[Voice] ▶️ Tiempo agotado sin orden. Reanudando audio...");
                                isAudioPaused = false;
                                isAwaitingCommand = false;
                                updateStateUI('SPEAKING');
                                currentAudio.play().catch(e => console.warn(e));
                            }
                        }, 6000);
                        return;
                    }

                    // Si NO contiene la palabra de activación 'Cronos':
                    // Mientras Cronos habla, ignorar lo que sea eco del altavoz o palabras sin 'Cronos'
                    if (isSpokenTextEcho(currentText)) {
                        return;
                    }

                    return;
                }

                // 2. GESTIÓN MIENTRAS EL AUDIO ESTÁ EN PAUSA
                if (isAudioPaused && currentAudio) {
                    if (isSpokenTextEcho(currentText)) return;

                    const cleanWithoutWake = removeWakeWord(currentText);

                    // Durante la pausa, Cronos está en silencio. Si el usuario dice "para", "cállate", "cancela" o "Cronos para"
                    const isStop = isStopPhrase(currentText) ||
                                   isStopPhrase(cleanWithoutWake) ||
                                   /\b(para|parar|ya|calla|callate|silencio|stop|basta|alto|detente|cancela|dejalo)\b/i.test(currentText) ||
                                   /\b(para|parar|ya|calla|callate|silencio|stop|basta|alto|detente|cancela|dejalo)\b/i.test(cleanWithoutWake);

                    if (isStop) {
                        console.log("[Voice] 🛑 Cancelación definitiva durante pausa:", currentText);
                        clearTimeout(pauseResumeTimeout);
                        clearTimeout(speechSilenceTimer);
                        isAudioPaused = false;
                        isAwaitingCommand = false;
                        currentAudio.pause();
                        currentAudio.currentTime = 0;
                        currentAudio = null;
                        updateStateUI('IDLE');
                        appendMessage('user', `🛑 (Cancelado: "${currentText}")`);
                        clearThinkingTimeout();
                        safeSendWs({ event: 'STOP_SPEAKING' });
                        if (recognition) {
                            try { recognition.abort(); } catch (e) {}
                        }
                        setTimeout(() => ensureRecognitionRunning(), 150);
                        return;
                    }

                    if (isResumePhrase(currentText)) {
                        console.log("[Voice] ▶️ Reanudando locución a petición del usuario:", currentText);
                        clearTimeout(pauseResumeTimeout);
                        clearTimeout(speechSilenceTimer);
                        isAudioPaused = false;
                        isAwaitingCommand = false;
                        updateStateUI('SPEAKING');
                        appendMessage('user', `▶️ (Reanudar: "${currentText}")`);
                        currentAudio.play().catch(e => console.warn(e));
                        return;
                    }

                    if (isSpokenTextEcho(currentText)) return;

                    let pauseCmd = removeWakeWord(currentText);
                    if (pauseCmd && !isSpokenTextEcho(pauseCmd)) {
                        const executePauseCmd = () => {
                            console.log("[Voice] 🔄 Nueva orden mientras estaba pausado:", pauseCmd);
                            clearTimeout(pauseResumeTimeout);
                            clearTimeout(speechSilenceTimer);
                            isAudioPaused = false;
                            isAwaitingCommand = false;
                            currentAudio.pause();
                            currentAudio.currentTime = 0;
                            currentAudio = null;
                            dispatchVoiceCommand(pauseCmd);
                        };

                        if (finalTranscript.trim()) {
                            executePauseCmd();
                            return;
                        }

                        clearTimeout(speechSilenceTimer);
                        speechSilenceTimer = setTimeout(() => {
                            if (isAudioPaused && currentAudio) {
                                executePauseCmd();
                            }
                        }, 650);
                        return;
                    }
                    return;
                }

                // SUPRESIÓN DE ECO
                if (Date.now() - audioJustEndedTimestamp < 800) {
                    return;
                }
                if (isSpokenTextEcho(currentText)) {
                    console.log("[Audio] 🔇 Eco de la voz de Cronos suprimido:", currentText);
                    return;
                }

                // 3. Si ya estábamos esperando el comando tras haber dicho "Cronos" o por conversación continua
                if (isAwaitingCommand) {
                    if (isStopPhrase(currentText)) {
                        clearTimeout(commandTimeout);
                        clearTimeout(speechSilenceTimer);
                        isAwaitingCommand = false;
                        updateStateUI('IDLE');
                        return;
                    }

                    if (isSpokenTextEcho(currentText)) return;

                    let cmd = removeWakeWord(currentText);

                    // Si el usuario dijo simplemente "Cronos" otra vez
                    if (!cmd || cmd.length === 0) {
                        console.log("[WakeWord] 🗣️ Re-confirmación de 'Cronos' detectada en espera.");
                        playWakeChime();
                        clearTimeout(commandTimeout);
                        clearTimeout(speechSilenceTimer);
                        commandTimeout = setTimeout(() => {
                            if (isAwaitingCommand) {
                                isAwaitingCommand = false;
                                updateStateUI('IDLE');
                            }
                        }, 7000);
                        return;
                    }

                    if (isSpokenTextEcho(cmd)) return;

                    if (isStopPhrase(cmd)) {
                        clearTimeout(commandTimeout);
                        clearTimeout(speechSilenceTimer);
                        isAwaitingCommand = false;
                        updateStateUI('IDLE');
                        return;
                    }

                    // Si ya es finalTranscript, despachar de inmediato
                    if (finalTranscript.trim()) {
                        console.log("[Voice] ⚡ Final transcript recibido:", cmd);
                        dispatchVoiceCommand(cmd);
                        return;
                    }

                    // Si es interimTranscript, activar temporizador de pausa/silencio (debounce 650ms)
                    clearTimeout(speechSilenceTimer);
                    speechSilenceTimer = setTimeout(() => {
                        if (isAwaitingCommand) {
                            console.log("[Debounce] ⏱️ Silencio detectado tras orden hablada:", cmd);
                            dispatchVoiceCommand(cmd);
                        }
                    }, 650);
                    return;
                }

                // 4. Reposo: comprobar si aparece la palabra de activación "Cronos"
                const wakeMatch = matchWakeWord(currentText);
                if (wakeMatch) {
                    const restOfSentence = (wakeMatch[1] || '').trim();

                    if (isStopPhrase(restOfSentence)) {
                        console.log("[WakeWord] 🛑 'Cronos para' detectado en reposo.");
                        updateStateUI('IDLE');
                        isAwaitingCommand = false;
                        clearTimeout(speechSilenceTimer);
                        clearThinkingTimeout();
                        safeSendWs({ event: 'STOP_SPEAKING' });
                        return;
                    }

                    if (isSpokenTextEcho(restOfSentence)) return;

                    console.log("[WakeWord] 🗣️ ¡Palabra clave 'Cronos' detectada!");
                    playWakeChime();
                    updateStateUI('LISTENING');
                    isAwaitingCommand = true;
                    safeSendWs({ event: 'WAKE_WORD_DETECTED' });

                    clearTimeout(commandTimeout);
                    commandTimeout = setTimeout(() => {
                        if (isAwaitingCommand) {
                            console.log("[WakeWord] Tiempo de espera agotado sin orden.");
                            isAwaitingCommand = false;
                            updateStateUI('IDLE');
                        }
                    }, 7000);

                    if (restOfSentence && restOfSentence.length > 0) {
                        if (finalTranscript.trim()) {
                            console.log("[WakeWord] ⚡ Comando continuo inmediato:", restOfSentence);
                            dispatchVoiceCommand(restOfSentence);
                        } else {
                            clearTimeout(speechSilenceTimer);
                            speechSilenceTimer = setTimeout(() => {
                                if (isAwaitingCommand) {
                                    console.log("[Debounce] ⏱️ Silencio detectado tras 'Cronos <comando>':", restOfSentence);
                                    dispatchVoiceCommand(restOfSentence);
                                }
                            }, 650);
                        }
                    }
                }
            };

            recognition.onerror = (event) => {
                console.warn("[SpeechRecognition] Evento:", event.error);
                if (event.error === 'not-allowed') {
                    wakeWordListening = false;
                    micBlocked = true;
                    showMicPermissionHelp();
                } else if (event.error === 'service-not-allowed') {
                    wakeWordListening = false;
                    micBlocked = true;
                    appendMessage('Cronos', '⚠️ El servicio de reconocimiento de voz del navegador no está disponible o está restringido.');
                }
            };

            recognition.onend = () => {
                isRecording = false;
                micButton.classList.remove('recording');
                const mobileMic = document.getElementById('mobileMainMicBtn');
                if (mobileMic) mobileMic.classList.remove('recording');

                // Si la escucha continua de "Cronos" está habilitada y no estamos grabando biometría, reiniciar
                if (wakeWordListening && !micBlocked && !isEnrollRecordingActive) {
                    setTimeout(() => {
                        ensureRecognitionRunning();
                    }, 200);
                } else {
                    if (stateText.innerText === 'ESCUCHANDO' && !isEnrollRecordingActive) {
                        updateStateUI('IDLE');
                    }
                }
            };
        } else {
            console.warn("SpeechRecognition no está soportado en este navegador.");
        }

        async function handleWsMessage(event) {
            clearThinkingTimeout();
            // Manejo de AUDIO (Binario) desde el TTS de Cronos
            if (event.data instanceof ArrayBuffer) {
                if (!event.data || event.data.byteLength < 50) return;
                clearTimeout(pauseResumeTimeout);
                isAudioPaused = false;
                if (currentAudio) {
                    currentAudio.pause();
                    currentAudio.currentTime = 0;
                }
                
                // Auto-detectar formato: WAV (Piper local) vs MP3 (Edge TTS nube)
                const bytes = new Uint8Array(event.data.slice(0, 4));
                const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // "RIFF"
                const mimeType = isWav ? 'audio/wav' : 'audio/mpeg';
                const audioBlob = new Blob([event.data], { type: mimeType });
                const audioUrl = URL.createObjectURL(audioBlob);
                currentAudio = new Audio(audioUrl);
                
                // Asegurar que el micrófono sigue activo escuchando "Cronos para"
                ensureRecognitionRunning();
                
                const onAudioDone = () => {
                    audioJustEndedTimestamp = Date.now();
                    currentAudio = null;
                    clearTimeout(pauseResumeTimeout);
                    isAudioPaused = false;
                    
                    // Purgar y reiniciar limpiamente el búfer del micrófono para que nunca se cuele lo que dijo el altavoz
                    if (recognition) {
                        try { recognition.abort(); } catch (e) {}
                    }
                    setTimeout(() => ensureRecognitionRunning(), 200);

                    if (expectResponse) {
                        expectResponse = false;
                        isAwaitingCommand = true;
                        updateStateUI('LISTENING');
                        clearTimeout(commandTimeout);
                        commandTimeout = setTimeout(() => {
                            if (isAwaitingCommand) {
                                isAwaitingCommand = false;
                                updateStateUI('IDLE');
                            }
                        }, 7000);
                    } else {
                        isAwaitingCommand = false;
                        updateStateUI('IDLE');
                    }
                };

                currentAudio.onplay = () => {
                    ensureRecognitionRunning();
                };
                currentAudio.onended = onAudioDone;
                currentAudio.onerror = (err) => {
                    console.warn("[Audio] Error en reproducción:", err);
                    onAudioDone();
                };
                
                currentAudio.play().catch(e => {
                    console.warn("[Audio] Error al reproducir:", e);
                    onAudioDone();
                });
                return;
            }

            // Manejo de ESTADOS (JSON)
            const data = JSON.parse(event.data);
            
            if (data.event === 'OPEN_MIC') {
                expectResponse = true;
            }

            if (data.state) {
                updateStateUI(data.state);
            }

            if (data.event === 'TRIGGER_VOICE_ENROLLMENT') {
                console.log("[Biometrics] 🎙️ Petición de registro de voz recibida para:", data.username);
                const targetUser = data.username || identityInput.value.trim() || 'Juanes';
                if (currentAudio && !currentAudio.paused) {
                    const prevOnEnded = currentAudio.onended;
                    currentAudio.onended = () => {
                        if (prevOnEnded) prevOnEnded();
                        setTimeout(() => triggerVoiceEnrollmentFlow(targetUser), 600);
                    };
                } else {
                    setTimeout(() => triggerVoiceEnrollmentFlow(targetUser), 800);
                }
            }

            if (data.type === 'text_response') {
                if (data.text === lastCronosSpokenText && (Date.now() - (window._lastCronosSpokenTime || 0) < 2000)) {
                    console.log("[Chat] 🛡️ Mensaje de texto duplicado de Cronos ignorado.");
                    return;
                }
                lastCronosSpokenText = data.text || '';
                window._lastCronosSpokenTime = Date.now();
                appendMessage('Cronos', data.text);
            }
        };

        function setQuickIdentity(name) {
            if (identityInput) {
                identityInput.value = name;
                localStorage.setItem('Cronos_user_identity', name);
                appendMessage('Cronos', `Identidad activa en este dispositivo: <b>${name}</b>.`);
            }
        }

        function appendMessage(sender, text) {
            const div = document.createElement('div');
            div.className = `msg ${sender}`;
            if (sender === 'Cronos') {
                div.innerHTML = text;
            } else {
                div.innerText = text;
            }
            chatBox.appendChild(div);
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        async function toggleMic() {
            // Si Cronos está hablando o pausado y pulsamos el núcleo, cortamos su voz de inmediato
            if (currentAudio) {
                clearTimeout(pauseResumeTimeout);
                isAudioPaused = false;
                currentAudio.pause();
                currentAudio.currentTime = 0;
                currentAudio = null;
                updateStateUI('IDLE');
                return;
            }

            if (!recognition) {
                appendMessage('Cronos', '⚠️ Tu navegador actual no soporta reconocimiento de voz nativo (SpeechRecognition). Te sugerimos abrir la interfaz en <b>Google Chrome</b> o <b>Microsoft Edge</b>.');
                return;
            }

            // Asegurar permisos y contexto antes de activar
            const granted = await ensureMicPermission();
            if (!granted) return;

            wakeWordListening = true;
            micBlocked = false;

            try {
                if (!isRecording) {
                    recognition.start();
                }
            } catch (err) {}

            // Al pulsar manualmente el núcleo, activamos inmediatamente la recepción de comando
            playWakeChime();
            isAwaitingCommand = true;
            updateStateUI('LISTENING');
            safeSendWs({ event: 'WAKE_WORD_DETECTED' });
            
            clearTimeout(commandTimeout);
            commandTimeout = setTimeout(() => {
                if (isAwaitingCommand) {
                    isAwaitingCommand = false;
                    updateStateUI('IDLE');
                }
            }, 7000);
        }

        // Iniciar escucha continua de palabra clave si ya hay permisos concedidos y sincronizar identidad
        window.addEventListener('DOMContentLoaded', async () => {
            const savedIdentity = localStorage.getItem('Cronos_user_identity') || 'Juanes';
            if (identityInput) {
                identityInput.value = savedIdentity;
                identityInput.addEventListener('input', () => {
                    const val = identityInput.value.trim();
                    if (val) localStorage.setItem('Cronos_user_identity', val);
                });
            }
            checkMicEnvironment();
            if (navigator.permissions && navigator.permissions.query) {
                try {
                    const status = await navigator.permissions.query({ name: 'microphone' });
                    if (status.state === 'granted') {
                        wakeWordListening = true;
                        try { recognition.start(); } catch(e){}
                    }
                } catch(e) {}
            }
        });

        function sendCommandText() {
            const text = input.value.trim();
            if (!text) return;
            appendMessage('user', text);
            input.value = '';

            if (isVoiceEnrollmentRequest(text)) {
                let user = (identityInput && identityInput.value.trim()) || localStorage.getItem('Cronos_user_identity') || 'Juanes';
                if (!user || user.toLowerCase() === 'invitado') user = 'Juanes';
                appendMessage('Cronos', `¡Entendido! Abriendo el calibrador biométrico para <b>${user}</b>. Prepárate para hablar.`);
                triggerVoiceEnrollmentFlow(user);
                return;
            }

            const currentIdentity = (identityInput && identityInput.value.trim()) || localStorage.getItem('Cronos_user_identity') || 'Juanes';
            updateStateUI('THINKING');
            startThinkingTimeout();

            safeSendWs({ 
                event: 'TEXT_COMMAND', 
                text: text,
                voice: voiceSelect.value,
                identity: currentIdentity,
                isSpoken: true
            });
        }

        function handleEnter(e) {
            if (e.key === 'Enter') sendCommandText();
        }

        // --- CONTROL DE VISTA MÓVIL (DESPLEGABLE CHAT Y AJUSTES) ---
        function toggleMobileChat(forceState) {
            const panelRight = document.getElementById('panelRight');
            const backdrop = document.getElementById('chatBackdrop');
            if (!panelRight) return;
            
            const shouldOpen = (typeof forceState === 'boolean') ? forceState : !panelRight.classList.contains('open');
            if (shouldOpen) {
                panelRight.classList.add('open');
                if (backdrop) backdrop.classList.add('open');
                // Foco en el input al abrir
                setTimeout(() => {
                    if (input) input.focus();
                }, 300);
            } else {
                panelRight.classList.remove('open');
                if (backdrop) backdrop.classList.remove('open');
            }
        }

        function toggleMobileSettings(forceState) {
            const settings = document.getElementById('settingsGroup');
            if (!settings) return;
            const shouldOpen = (typeof forceState === 'boolean') ? forceState : !settings.classList.contains('show');
            if (shouldOpen) {
                settings.classList.add('show');
            } else {
                settings.classList.remove('show');
            }
        }

        // Cerrar ajustes móviles al tocar fuera
        document.addEventListener('click', (e) => {
            const settings = document.getElementById('settingsGroup');
            const settingsBtn = document.getElementById('mobileSettingsBtn');
            if (settings && settings.classList.contains('show')) {
                if (!settings.contains(e.target) && (!settingsBtn || !settingsBtn.contains(e.target))) {
                    settings.classList.remove('show');
                }
            }
        });

        // --- GESTOR DE SKILLS ---
        async function openSkillsManager() {
            document.getElementById('skillsModal').style.display = 'flex';
            loadSkillsList();
        }

        function closeSkillsManager() {
            document.getElementById('skillsModal').style.display = 'none';
        }

        async function loadSkillsList() {
            const listDiv = document.getElementById('skillsList');
            listDiv.innerHTML = '<p style="color:#94a3b8; text-align:center;">Cargando extensiones...</p>';
            try {
                const res = await fetch('/api/skills');
                const skills = await res.json();
                listDiv.innerHTML = '';
                skills.forEach(s => {
                    const skillCard = document.createElement('div');
                    skillCard.className = 'skill-card';
                    skillCard.innerHTML = `
                        <div>
                            <div class="skill-title">${s.name.toUpperCase()}</div>
                            <div class="skill-file">📂 ${s.filename}</div>
                        </div>
                        <button class="toggle-btn ${s.active ? 'active' : ''}" onclick="toggleSkill('${s.filename}', ${!s.active})">
                            ${s.active ? 'ON' : 'OFF'}
                        </button>
                    `;
                    listDiv.appendChild(skillCard);
                });
            } catch (e) {
                listDiv.innerHTML = '<p style="color:#ef4444; text-align:center;">Error cargando skills.</p>';
            }
        }

        async function toggleSkill(filename, activate) {
            try {
                const res = await fetch('/api/skills/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename, activate })
                });
                if (res.ok) {
                    loadSkillsList(); // Recargar lista visual
                } else {
                    alert("Error al cambiar estado de la skill");
                }
            } catch (e) {
                console.error(e);
            }
        }

        // --- GESTOR DE RUTINAS ---
        let editingRoutineId = null;

        function openRoutinesManager() {
            document.getElementById('routinesModal').style.display = 'flex';
            loadRoutinesList();
        }

        function closeRoutinesManager() {
            document.getElementById('routinesModal').style.display = 'none';
        }

        async function loadRoutinesList() {
            const listDiv = document.getElementById('routinesList');
            listDiv.innerHTML = '<p style="color:#94a3b8; text-align:center;">Cargando rutinas...</p>';
            try {
                const res = await fetch('/api/routines');
                const routines = await res.json();
                listDiv.innerHTML = '';
                
                if (routines.length === 0) {
                    listDiv.innerHTML = '<p style="color:#94a3b8; text-align:center;">No hay rutinas programadas.</p>';
                    return;
                }

                routines.forEach(r => {
                    const rCard = document.createElement('div');
                    rCard.className = 'skill-card';
                    rCard.innerHTML = `
                        <div style="flex: 1;">
                            <div class="skill-title">${r.name.toUpperCase()} <span style="font-size: 10px; color:#4ade80; margin-left:8px;">👤 ${r.username || 'Juanes'}</span></div>
                            <div class="skill-file">⏱️ ${r.cronExpression}</div>
                            <div class="skill-file" style="color:#64748b; margin-top:2px;">"${r.prompt}"</div>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button class="toggle-btn" style="color:#38bdf8; border: 1px solid rgba(56, 189, 248, 0.4);" onclick="editRoutineForm('${r.id}', '${r.name.replace(/'/g, "\\'")}', '${r.cronExpression}', '${r.prompt.replace(/'/g, "\\'")}', '${r.username || 'Juanes'}')">
                                ✏️
                            </button>
                            <button class="toggle-btn ${r.active ? 'active' : ''}" onclick="toggleRoutine('${r.id}', ${!r.active})">
                                ${r.active ? 'ON' : 'OFF'}
                            </button>
                            <button class="toggle-btn" style="color:#ef4444; border: 1px solid rgba(239, 68, 68, 0.4);" onclick="deleteRoutine('${r.id}')">
                                🗑️
                            </button>
                        </div>
                    `;
                    listDiv.appendChild(rCard);
                });
            } catch (e) {
                listDiv.innerHTML = '<p style="color:#ef4444; text-align:center;">Error cargando rutinas.</p>';
            }
        }

        function editRoutineForm(id, name, cron, prompt, username) {
            editingRoutineId = id;
            document.getElementById('newRoutineName').value = name;
            
            // Parse cron "30 7 * * *" to "07:30"
            const parts = cron.split(' ');
            if (parts.length >= 2) {
                const min = parts[0].padStart(2, '0');
                const hr = parts[1].padStart(2, '0');
                document.getElementById('newRoutineTime').value = `${hr}:${min}`;
            }
            
            document.getElementById('newRoutinePrompt').value = prompt;
            document.getElementById('identityInput').value = username;
            
            const btn = document.getElementById('saveRoutineBtn');
            if(btn) {
                btn.innerText = "Actualizar Rutina";
                btn.style.background = "rgba(56, 189, 248, 0.2)";
                btn.style.color = "#38bdf8";
            }
        }

        async function toggleRoutine(id, activate) {
            try {
                const res = await fetch(`/api/routines/${id}/toggle`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active: activate })
                });
                if (res.ok) loadRoutinesList();
            } catch (e) {
                console.error(e);
            }
        }

        async function deleteRoutine(id) {
            if (!confirm('¿Seguro que quieres borrar esta rutina?')) return;
            try {
                const res = await fetch(`/api/routines/${id}`, { method: 'DELETE' });
                if (res.ok) loadRoutinesList();
            } catch (e) {
                console.error(e);
            }
        }

        async function createManualRoutine() {
            const name = document.getElementById('newRoutineName').value;
            const time = document.getElementById('newRoutineTime').value;
            const prompt = document.getElementById('newRoutinePrompt').value;
            
            if (!name || !time || !prompt) {
                alert("Por favor, rellena todos los campos.");
                return;
            }

            // Convertir hora (ej: "15:30") a formato cron ("30 15 * * *")
            const [hour, minute] = time.split(':');
            const cronExpression = `${parseInt(minute)} ${parseInt(hour)} * * *`;
            const username = document.getElementById('identityInput').value || 'Juanes';

            const method = editingRoutineId ? 'PUT' : 'POST';
            const url = editingRoutineId ? `/api/routines/${editingRoutineId}` : '/api/routines';

            try {
                const res = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, cronExpression, prompt, username })
                });
                
                if (res.ok) {
                    editingRoutineId = null;
                    document.getElementById('newRoutineName').value = '';
                    document.getElementById('newRoutineTime').value = '';
                    document.getElementById('newRoutinePrompt').value = '';
                    
                    const btn = document.getElementById('saveRoutineBtn');
                    if(btn) {
                        btn.innerText = "Guardar Rutina";
                        btn.style.background = "rgba(34, 197, 94, 0.2)";
                        btn.style.color = "#4ade80";
                    }

                    loadRoutinesList();
                } else {
                    alert("Error al guardar la rutina");
                }
            } catch (e) {
                console.error(e);
            }
        }

        // ==========================================
        // GESTOR DE PERFILES BIOMÉTRICOS DE VOZ
        // ==========================================
        function openVoiceProfilesModal() {
            const modal = document.getElementById('voiceProfilesModal');
            if (modal) {
                modal.style.display = 'flex';
                modal.classList.add('open');
                loadVoiceProfilesList();
                const identifyBox = document.getElementById('identifyResultBox');
                if (identifyBox) identifyBox.style.display = 'none';
            }
        }

        function closeVoiceProfilesModal() {
            const modal = document.getElementById('voiceProfilesModal');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('open');
            }
            if (stateText.innerText === 'HABLANDO' || screen.classList.contains('state-speaking')) {
                updateStateUI('IDLE');
            }
            isAwaitingCommand = false;
            if (wakeWordListening && !micBlocked && !isEnrollRecordingActive) {
                setTimeout(() => ensureRecognitionRunning(), 300);
            }
        }

        async function loadVoiceProfilesList() {
            const listDiv = document.getElementById('voiceProfilesList');
            if (!listDiv) return;
            listDiv.innerHTML = '<p style="color:#94a3b8; text-align:center;">Cargando perfiles...</p>';

            try {
                const res = await fetch('/api/voice-profiles');
                const data = await res.json();
                const profiles = data.profiles || [];

                if (profiles.length === 0) {
                    listDiv.innerHTML = '<p style="color:#94a3b8; text-align:center; padding:10px;">No hay perfiles de voz guardados.<br><span style="font-size:11px; color:#64748b;">Graba tu voz arriba para que Cronos te reconozca automáticamente.</span></p>';
                    return;
                }

                listDiv.innerHTML = '';
                profiles.forEach(p => {
                    const card = document.createElement('div');
                    card.className = 'skill-card';
                    card.innerHTML = `
                        <div style="flex: 1;">
                            <div class="skill-title">👤 ${p.name} <span style="font-size: 10px; color:#00e5ff; margin-left:6px;">[Activo]</span></div>
                            <div class="skill-file">📁 ${p.filename} (${Math.round(p.size / 1024)} KB)</div>
                        </div>
                        <div>
                            <button class="toggle-btn" style="color:#ef4444; border: 1px solid rgba(239, 68, 68, 0.4);" onclick="deleteVoiceProfile('${p.id}')" title="Eliminar huella">
                                🗑️
                            </button>
                        </div>
                    `;
                    listDiv.appendChild(card);
                });

                if (profiles.length > 0) {
                    const saved = localStorage.getItem('Cronos_user_identity');
                    if (!saved || saved.toLowerCase() === 'invitado') {
                        localStorage.setItem('Cronos_user_identity', profiles[0].name);
                    }
                    if (identityInput && (!identityInput.value.trim() || identityInput.value.toLowerCase() === 'invitado')) {
                        identityInput.value = profiles[0].name;
                    }
                }
            } catch (e) {
                listDiv.innerHTML = '<p style="color:#ef4444; text-align:center;">Error al cargar perfiles.</p>';
            }
        }

        async function deleteVoiceProfile(id) {
            if (!confirm(`¿Eliminar la huella de voz de "${id}"?`)) return;
            try {
                const res = await fetch(`/api/voice-profiles/${id}`, { method: 'DELETE' });
                if (res.ok) loadVoiceProfilesList();
            } catch (e) {
                console.error(e);
            }
        }

        // Graba audio en PCM Mono 16kHz y genera un Blob WAV estándar
        async function recordRawWav(durationMs, statusCallback) {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    channelCount: 1, 
                    echoCancellation: true, 
                    noiseSuppression: true, 
                    autoGainControl: true 
                } 
            });

            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioContextClass();
            const source = audioCtx.createMediaStreamSource(stream);
            const scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);

            const collectedSamples = [];
            const originalSampleRate = audioCtx.sampleRate;

            scriptNode.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                collectedSamples.push(new Float32Array(inputData));
            };

            source.connect(scriptNode);
            scriptNode.connect(audioCtx.destination);

            const startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const remaining = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
                if (statusCallback) statusCallback(remaining);
            }, 200);

            await new Promise(r => setTimeout(r, durationMs));

            clearInterval(interval);
            source.disconnect();
            scriptNode.disconnect();
            stream.getTracks().forEach(t => t.stop());
            await audioCtx.close();

            // Unir todos los buffers float32
            let totalLength = 0;
            for (const chunk of collectedSamples) totalLength += chunk.length;
            const merged = new Float32Array(totalLength);
            let offset = 0;
            for (const chunk of collectedSamples) {
                merged.set(chunk, offset);
                offset += chunk.length;
            }

            // Remuestrear a 16000 Hz si es necesario
            const targetSampleRate = 16000;
            let finalSamples = merged;
            if (originalSampleRate !== targetSampleRate) {
                const ratio = originalSampleRate / targetSampleRate;
                const newLength = Math.round(merged.length / ratio);
                finalSamples = new Float32Array(newLength);
                for (let i = 0; i < newLength; i++) {
                    const origIndex = Math.round(i * ratio);
                    finalSamples[i] = merged[Math.min(origIndex, merged.length - 1)];
                }
            }

            // Codificar WAV 16-bit PCM RIFF
            const wavBuffer = new ArrayBuffer(44 + finalSamples.length * 2);
            const view = new DataView(wavBuffer);

            function writeStr(offset, str) {
                for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
            }

            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + finalSamples.length * 2, true);
            writeStr(8, 'WAVE');
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true); // PCM
            view.setUint16(22, 1, true); // Mono
            view.setUint32(24, targetSampleRate, true);
            view.setUint32(28, targetSampleRate * 2, true);
            view.setUint16(32, 2, true); // Block align
            view.setUint16(34, 16, true); // 16 bits
            writeStr(36, 'data');
            view.setUint32(40, finalSamples.length * 2, true);

            let dataOffset = 44;
            for (let i = 0; i < finalSamples.length; i++) {
                let s = Math.max(-1, Math.min(1, finalSamples[i]));
                view.setInt16(dataOffset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                dataOffset += 2;
            }

            return new Blob([view], { type: 'audio/wav' });
        }

        function blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64data = reader.result.split(',')[1];
                    resolve(base64data);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        async function startVoiceEnrollment(autoRestartRecognition = true) {
            const nameInput = document.getElementById('voiceProfileName');
            let name = (nameInput.value || '').trim();
            if (!name || name.toLowerCase() === 'invitado') name = (identityInput && identityInput.value.trim()) || 'Juanes';
            if (nameInput) nameInput.value = name;

            const statusEl = document.getElementById('enrollRecordStatus');
            const enrollBtn = document.getElementById('startEnrollBtn');
            const testBtn = document.getElementById('testIdentifyBtn');

            enrollBtn.disabled = true;
            testBtn.disabled = true;
            isEnrollRecordingActive = true;
            if (recognition) {
                try { recognition.abort(); } catch (e) {}
            }

            let enrollmentSuccess = false;

            try {
                statusEl.innerHTML = `🔴 <b>Grabando tu voz (5s)...</b> Di una frase con calma: <br><i>"Hola Cronos, soy ${name} y este es mi perfil de voz."</i>`;
                statusEl.style.color = '#ff2d55';

                const wavBlob = await recordRawWav(5000, (remaining) => {
                    statusEl.innerHTML = `🔴 <b>Grabando (${remaining}s)...</b> Di: <i>"Hola Cronos, soy ${name}."</i>`;
                });

                statusEl.innerHTML = '⏳ <b>Procesando y guardando huella acústica...</b>';
                statusEl.style.color = '#00e5ff';

                const base64Audio = await blobToBase64(wavBlob);
                const res = await fetch('/api/voice-profiles/enroll', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, audioBase64: base64Audio })
                });

                let result;
                try {
                    result = await res.json();
                } catch (e) {
                    throw new Error(`Respuesta inválida del servidor (HTTP ${res.status})`);
                }

                if (res.ok && result.success) {
                    enrollmentSuccess = true;
                    statusEl.innerHTML = `✅ <b>¡Huella de voz registrada con éxito para ${name}!</b>`;
                    statusEl.style.color = '#4ade80';
                    loadVoiceProfilesList();
                    const idInput = document.getElementById('identityInput');
                    if (idInput) idInput.value = name;
                    localStorage.setItem('Cronos_user_identity', name);
                } else {
                    statusEl.innerHTML = `❌ Error: ${result.error || 'No se pudo guardar'}`;
                    statusEl.style.color = '#ef4444';
                }
            } catch (err) {
                console.error("[Biometrics] Error al registrar voz:", err);
                statusEl.innerHTML = `⚠️ Error al registrar voz: ${err.message}`;
                statusEl.style.color = '#ef4444';
            } finally {
                isEnrollRecordingActive = false;
                enrollBtn.disabled = false;
                testBtn.disabled = false;
                if (autoRestartRecognition && wakeWordListening && !micBlocked) {
                    setTimeout(() => ensureRecognitionRunning(), 500);
                }
            }

            return enrollmentSuccess;
        }

        async function testVoiceIdentification() {
            const statusEl = document.getElementById('enrollRecordStatus');
            const resultBox = document.getElementById('identifyResultBox');
            const enrollBtn = document.getElementById('startEnrollBtn');
            const testBtn = document.getElementById('testIdentifyBtn');

            enrollBtn.disabled = true;
            testBtn.disabled = true;
            resultBox.style.display = 'none';
            isEnrollRecordingActive = true;
            if (recognition) {
                try { recognition.abort(); } catch (e) {}
            }

            try {
                statusEl.innerHTML = '🟣 <b>Habla ahora durante 4 segundos...</b> (Di cualquier frase)';
                statusEl.style.color = '#c084fc';

                const wavBlob = await recordRawWav(4000, (remaining) => {
                    statusEl.innerHTML = `🟣 <b>Escuchando (${remaining}s)...</b> Di cualquier cosa.`;
                });

                statusEl.innerHTML = '🧠 <b>Comparando con la red neuronal de locutores...</b>';
                statusEl.style.color = '#00e5ff';

                const base64Audio = await blobToBase64(wavBlob);
                const res = await fetch('/api/voice-profiles/identify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ audioBase64: base64Audio })
                });

                let result;
                try {
                    result = await res.json();
                } catch (e) {
                    throw new Error(`Respuesta inválida del servidor (HTTP ${res.status})`);
                }
                resultBox.style.display = 'block';

                if (res.ok && result.success) {
                    const isIdentified = result.user && result.user.toLowerCase() !== 'invitado' && result.user.toLowerCase() !== 'desconocido';
                    if (isIdentified) {
                        resultBox.innerHTML = `
                            <div style="color:#4ade80; font-weight:700; font-size:14px; margin-bottom:4px;">
                                🎯 ¡Identificado como: ${result.user}!
                            </div>
                            <div style="color:#94a3b8; font-size:12px;">
                                Similitud biométrica: <b>${result.score}</b> (Umbral: 0.28)
                            </div>
                            ${result.text ? `<div style="color:#e2e8f0; margin-top:4px; font-style:italic;">"${result.text}"</div>` : ''}
                        `;
                        statusEl.innerHTML = '✅ Reconocimiento completado.';
                        statusEl.style.color = '#4ade80';
                        const idInput = document.getElementById('identityInput');
                        if (idInput) {
                            idInput.value = result.user;
                            localStorage.setItem('Cronos_user_identity', result.user);
                        }
                    } else {
                        resultBox.innerHTML = `
                            <div style="color:#f59e0b; font-weight:700; font-size:13px; margin-bottom:4px;">
                                👤 Clasificado como: Invitado
                            </div>
                            <div style="color:#94a3b8; font-size:12px;">
                                Similitud máxima alcanzada: <b>${result.score || 0}</b> (por debajo del umbral)
                            </div>
                        `;
                        statusEl.innerHTML = '⚠️ Voz no coincide con ningún perfil registrado.';
                        statusEl.style.color = '#f59e0b';
                    }
                } else {
                    resultBox.innerHTML = `<span style="color:#ef4444;">${result.message || 'Servicio biométrico no respondió.'}</span>`;
                    statusEl.innerHTML = '';
                }
            } catch (err) {
                console.error(err);
                statusEl.innerHTML = `⚠️ Error al probar: ${err.message}`;
                statusEl.style.color = '#ef4444';
            } finally {
                isEnrollRecordingActive = false;
                enrollBtn.disabled = false;
                testBtn.disabled = false;
                if (wakeWordListening && !micBlocked) {
                    setTimeout(() => ensureRecognitionRunning(), 400);
                }
            }
        }

        // Flujo guiado automáticamente por voz para calibrar y registrar la huella
        async function triggerVoiceEnrollmentFlow(username = 'Juanes') {
            if (!username || username.toLowerCase() === 'invitado') {
                username = (identityInput && identityInput.value.trim()) || 'Juanes';
            }
            openVoiceProfilesModal();
            const nameInput = document.getElementById('voiceProfileName');
            if (nameInput) nameInput.value = username;

            const statusEl = document.getElementById('enrollRecordStatus');
            const enrollBtn = document.getElementById('startEnrollBtn');
            const testBtn = document.getElementById('testIdentifyBtn');
            if (!statusEl) return;

            enrollBtn.disabled = true;
            testBtn.disabled = true;

            // 1. Cuenta atrás de preparación de 3 segundos
            statusEl.style.color = '#00e5ff';
            for (let c = 3; c > 0; c--) {
                statusEl.innerHTML = `🎙️ <b>Calibración biométrica para "${username}"</b><br>Prepárate para hablar en: <span style="font-size:22px; color:#f59e0b; font-weight:800;">${c}...</span>`;
                await new Promise(r => setTimeout(r, 1000));
            }

            // 2. Iniciar la grabación de 5 segundos sin reiniciar el micro inmediatamente
            const success = await startVoiceEnrollment(false);

            // 3. Finalización garantizada y desbloqueo de la interfaz
            const finishEnrollmentFlow = () => {
                if (success) {
                    appendMessage('Cronos', `✅ ¡Huella de voz registrada con éxito para <b>${username}</b>! Ya te reconozco al hablar.`);
                } else {
                    appendMessage('Cronos', `⚠️ No se pudo completar el registro de huella. Puedes intentarlo de nuevo desde Ajustes.`);
                }
                updateStateUI('IDLE');
                isAwaitingCommand = false;
                
                // Cerrar modal automáticamente tras 1.2s
                setTimeout(() => {
                    closeVoiceProfilesModal();
                }, 1200);

                // Reactivar escucha de "Cronos" de forma limpia
                setTimeout(() => {
                    if (wakeWordListening && !micBlocked) {
                        ensureRecognitionRunning();
                    }
                }, 1600);
            };

            // 4. Confirmación auditiva por voz
            if ('speechSynthesis' in window && success) {
                try {
                    window.speechSynthesis.cancel();
                    const utt = new SpeechSynthesisUtterance(`Tu huella de voz ha sido registrada con éxito, ${username}.`);
                    utt.lang = 'es-ES';
                    let finished = false;
                    const onDone = () => {
                        if (finished) return;
                        finished = true;
                        finishEnrollmentFlow();
                    };
                    utt.onend = onDone;
                    utt.onerror = onDone;
                    setTimeout(onDone, 4000); // Fallback de seguridad
                    window.speechSynthesis.speak(utt);
                } catch (e) {
                    finishEnrollmentFlow();
                }
            } else {
                finishEnrollmentFlow();
            }
        }

        // ==========================================
        // GESTOR DE AUTOAPRENDIZAJE Y CEREBRO
        // ==========================================
        let currentLearningTab = 'lessons';
        let cachedLearningData = null;

        function openLearningModal() {
            const modal = document.getElementById('learningModal');
            if (modal) {
                modal.style.display = 'flex';
                modal.classList.add('open');
                loadLearningData();
            }
        }

        function closeLearningModal() {
            const modal = document.getElementById('learningModal');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('open');
            }
        }

        function switchLearningTab(tabName) {
            currentLearningTab = tabName;
            ['lessons', 'memories', 'curiosity'].forEach(t => {
                const btn = document.getElementById(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
                const content = document.getElementById(`tabContent${t.charAt(0).toUpperCase() + t.slice(1)}`);
                if (btn && content) {
                    if (t === tabName) {
                        btn.style.background = 'rgba(168, 85, 247, 0.25)';
                        btn.style.color = '#c084fc';
                        content.style.display = 'block';
                    } else {
                        btn.style.background = 'rgba(255, 255, 255, 0.05)';
                        btn.style.color = '#94a3b8';
                        content.style.display = 'none';
                    }
                }
            });
            renderLearningTabContent();
        }

        async function loadLearningData() {
            const summaryEl = document.getElementById('learningStatsSummary');
            if (summaryEl) summaryEl.innerHTML = '⏳ Obteniendo estado del cerebro y recuerdos...';

            try {
                const res = await fetch('/api/learning/stats');
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Error al obtener datos');

                cachedLearningData = data;

                // Actualizar resumen
                const stats = data.stats || {};
                const learner = data.learnerState || {};
                const lessons = data.lessons || [];
                const memories = data.memories || [];
                const queue = data.curiosityQueue || [];
                const explored = data.exploredTopics || [];

                document.getElementById('lessonsCount').innerText = lessons.length;
                document.getElementById('memoriesCount').innerText = memories.length;
                document.getElementById('curiosityCount').innerText = queue.length + explored.length;

                const lastProcessed = learner.lastProcessedIndex || 0;
                const total = stats.totalInteractions || 0;
                const pending = Math.max(0, total - lastProcessed);

                if (summaryEl) {
                    summaryEl.innerHTML = `
                        <b>Interacciones registradas:</b> ${total} &bull; 
                        <b>Pendientes de procesar:</b> ${pending}<br>
                        <b>Lecciones activas:</b> ${lessons.length} &bull; 
                        <b>Recuerdos vectoriales:</b> ${memories.length} &bull; 
                        <b>Curiosidades:</b> ${queue.length} en cola / ${explored.length} exploradas
                    `;
                }

                renderLearningTabContent();
            } catch (err) {
                console.error("[Learning UI] Error:", err);
                if (summaryEl) summaryEl.innerHTML = `<span style="color:#ef4444;">⚠️ Error cargando datos: ${err.message}</span>`;
            }
        }

        function renderLearningTabContent() {
            if (!cachedLearningData) return;

            if (currentLearningTab === 'lessons') {
                const listDiv = document.getElementById('tabContentLessons');
                const lessons = cachedLearningData.lessons || [];
                if (lessons.length === 0) {
                    listDiv.innerHTML = '<p style="color:#94a3b8; text-align:center; padding:15px;">Aún no hay lecciones de comportamiento registradas.<br><span style="font-size:11px; color:#64748b;">Cuando corrijas a Cronos ("Cronos, no hagas esto..."), aprenderá de forma automática.</span></p>';
                    return;
                }
                listDiv.innerHTML = lessons.map(l => `
                    <div class="skill-card" style="margin-bottom: 8px;">
                        <div style="flex: 1;">
                            <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; margin-bottom: 3px;">
                                💡 ${escapeHtml(l.lesson)}
                            </div>
                            <div style="font-size: 11px; color: #94a3b8;">
                                <span style="background: rgba(168,85,247,0.2); color: #c084fc; padding: 1px 6px; border-radius: 6px; font-size: 10px;">${escapeHtml(l.category || 'general')}</span>
                                ${l.learnedAt ? `<span style="margin-left: 6px; color:#64748b;">${new Date(l.learnedAt).toLocaleDateString()}</span>` : ''}
                            </div>
                        </div>
                        <button class="toggle-btn" style="color:#ef4444; border: 1px solid rgba(239, 68, 68, 0.4); padding: 4px 8px;" onclick="deleteLearningLesson('${l.id}')" title="Olvidar lección">
                            🗑️
                        </button>
                    </div>
                `).join('');
            } else if (currentLearningTab === 'memories') {
                const listDiv = document.getElementById('tabContentMemories');
                const memories = cachedLearningData.memories || [];
                if (memories.length === 0) {
                    listDiv.innerHTML = '<p style="color:#94a3b8; text-align:center; padding:15px;">No hay recuerdos vectoriales todavía.<br><span style="font-size:11px; color:#64748b;">Cronos extrae datos y preferencias cuando hablas con él ("me gusta...", "mi trabajo es...").</span></p>';
                    return;
                }
                listDiv.innerHTML = memories.map(m => `
                    <div class="skill-card" style="margin-bottom: 8px;">
                        <div style="flex: 1;">
                            <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; margin-bottom: 3px;">
                                🧠 ${escapeHtml(m.text)}
                            </div>
                            <div style="font-size: 11px; color: #00e5ff;">
                                Usuario: <b>${escapeHtml(m.user || 'global')}</b>
                            </div>
                        </div>
                        <button class="toggle-btn" style="color:#ef4444; border: 1px solid rgba(239, 68, 68, 0.4); padding: 4px 8px;" onclick="deleteLearningMemory('${m.id}')" title="Olvidar recuerdo">
                            🗑️
                        </button>
                    </div>
                `).join('');
            } else if (currentLearningTab === 'curiosity') {
                const listDiv = document.getElementById('tabContentCuriosity');
                const queue = cachedLearningData.curiosityQueue || [];
                const explored = cachedLearningData.exploredTopics || [];

                let html = '';
                if (queue.length > 0) {
                    html += `<div style="font-size:11px; color:#c084fc; font-weight:700; text-transform:uppercase; margin-bottom:6px;">📋 Temas en cola para investigar (${queue.length}):</div>`;
                    html += queue.map(q => `
                        <div class="skill-card" style="margin-bottom: 6px; padding: 8px 12px;">
                            <div style="font-size: 12px; color: #e2e8f0;">🔍 <b>${escapeHtml(q.topic)}</b>: ${escapeHtml(q.reason || '')}</div>
                        </div>
                    `).join('');
                }

                if (explored.length > 0) {
                    html += `<div style="font-size:11px; color:#00e5ff; font-weight:700; text-transform:uppercase; margin-top:12px; margin-bottom:6px;">🌐 Investigaciones concluidas (${explored.length}):</div>`;
                    html += explored.map(e => `
                        <div class="skill-card" style="margin-bottom: 8px; flex-direction: column; align-items: flex-start;">
                            <div style="font-size: 13px; font-weight: 700; color: #00e5ff; margin-bottom: 4px;">
                                📖 ${escapeHtml(e.topic)}
                            </div>
                            <div style="font-size: 12px; color: #cbd5e1; line-height: 1.4;">
                                ${escapeHtml(e.summary)}
                            </div>
                        </div>
                    `).join('');
                }

                if (queue.length === 0 && explored.length === 0) {
                    html = '<p style="color:#94a3b8; text-align:center; padding:15px;">No hay curiosidades pendientes.<br><span style="font-size:11px; color:#64748b;">Cronos añade temas automáticamente cuando detecta conceptos nuevos en tus conversaciones.</span></p>';
                }
                listDiv.innerHTML = html;
            }
        }

        async function triggerManualLearningCycle() {
            const btn = document.getElementById('btnRunLearningCycle');
            const feedback = document.getElementById('learningActionFeedback');
            btn.disabled = true;
            feedback.style.color = '#c084fc';
            feedback.innerHTML = '🔄 Analizando interacciones y consolidando memoria con Ollama...';

            try {
                const res = await fetch('/api/learning/run-cycle', { method: 'POST' });
                const data = await res.json();
                if (data.success && data.result) {
                    const r = data.result;
                    feedback.style.color = '#4ade80';
                    feedback.innerHTML = `✅ Consolidación lista: ${r.analyzedInteractions || 0} analizadas, ${r.factsExtracted || 0} hechos, ${r.lessonsExtracted || 0} lecciones, ${r.curiositiesExtracted || 0} curiosidades.`;
                    await loadLearningData();
                } else {
                    feedback.style.color = '#f59e0b';
                    feedback.innerHTML = `ℹ️ ${data.result?.message || 'Ciclo finalizado.'}`;
                }
            } catch (e) {
                feedback.style.color = '#ef4444';
                feedback.innerHTML = `⚠️ Error ejecutando ciclo: ${e.message}`;
            } finally {
                btn.disabled = false;
            }
        }

        async function triggerManualCuriosityExplore() {
            const btn = document.getElementById('btnExploreCuriosity');
            const feedback = document.getElementById('learningActionFeedback');
            btn.disabled = true;
            feedback.style.color = '#00e5ff';
            feedback.innerHTML = '🌐 Buscando información en internet y sintetizando conocimiento...';

            try {
                const res = await fetch('/api/learning/explore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ count: 1 })
                });
                const data = await res.json();
                if (data.success && data.count > 0) {
                    feedback.style.color = '#4ade80';
                    feedback.innerHTML = `✅ Exploración completada: Se aprendió sobre "${data.explored[0]?.topic}".`;
                    await loadLearningData();
                } else {
                    feedback.style.color = '#f59e0b';
                    feedback.innerHTML = `ℹ️ No había temas pendientes en la cola de curiosidad.`;
                }
            } catch (e) {
                feedback.style.color = '#ef4444';
                feedback.innerHTML = `⚠️ Error explorando: ${e.message}`;
            } finally {
                btn.disabled = false;
            }
        }

        async function deleteLearningLesson(id) {
            if (!confirm("¿Eliminar esta lección del comportamiento de Cronos?")) return;
            try {
                const res = await fetch(`/api/learning/lessons/${id}`, { method: 'DELETE' });
                if (res.ok) await loadLearningData();
            } catch (e) {
                alert("Error eliminando lección");
            }
        }

        async function deleteLearningMemory(id) {
            if (!confirm("¿Eliminar este recuerdo de la memoria a largo plazo?")) return;
            try {
                const res = await fetch(`/api/learning/memories/${id}`, { method: 'DELETE' });
                if (res.ok) await loadLearningData();
            } catch (e) {
                alert("Error eliminando recuerdo");
            }
        }

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // --- SPOTIFY OAUTH & STATUS ---
        function openSpotifyAuth() {
            // Abrir flujo de login de Spotify (si es IP remota, ir por HTTPS para cumplir política de seguridad de Spotify)
            let targetUrl = '/spotify/login';
            if (window.location.protocol === 'http:' && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')) {
                targetUrl = `https://${window.location.hostname}:8443/spotify/login`;
            }
            const authWin = window.open(targetUrl, '_blank', 'width=600,height=750');
            const pollTimer = setInterval(() => {
                if (!authWin || authWin.closed) {
                    clearInterval(pollTimer);
                    checkSpotifyStatus();
                }
            }, 1500);
        }

        async function checkSpotifyStatus() {
            try {
                const res = await fetch('/api/spotify/status');
                const data = await res.json();
                const btn = document.getElementById('spotifyConnectBtn');
                if (btn) {
                    if (data.connected) {
                        const trackInfo = data.currentTrack ? ` (${data.currentTrack.slice(0, 20)}...)` : '';
                        btn.innerHTML = `🎵 Spotify: ${escapeHtml(data.user || 'Conectado')}${trackInfo}`;
                        btn.style.color = '#22c55e';
                        btn.style.borderColor = 'rgba(34, 197, 94, 0.6)';
                        btn.title = data.currentTrack ? `Sonando: ${data.currentTrack}` : 'Spotify vinculado y listo';
                    } else {
                        btn.innerHTML = '🎵 Vincular Spotify';
                        btn.style.color = '#4ade80';
                        btn.style.borderColor = 'rgba(34, 197, 94, 0.4)';
                    }
                }
            } catch (e) {}
        }
        setInterval(checkSpotifyStatus, 15000);
        setTimeout(checkSpotifyStatus, 1000);
    
