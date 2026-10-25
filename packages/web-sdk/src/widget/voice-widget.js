/**
 * Voice Commerce Assistant - Universal Embeddable Web Widget
 * Generic, zero-dependency embeddable script for any website or e-commerce platform.
 * 
 * Usage:
 * <script src="http://localhost:3000/voice-widget.js"
 *         data-tenant-id="tenant_arpzo"
 *         data-branch-id="branch_koramangala"
 *         data-api-url="http://localhost:8080"
 *         data-ws-url="ws://localhost:8081"
 *         data-user-ref="usr_cust_01">
 * </script>
 */

(function () {
  'use strict';

  // Read configuration from the script tag
  const currentScript = document.currentScript || (function() {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const CONFIG = {
    tenantId: currentScript?.getAttribute('data-tenant-id') || 'tenant_arpzo',
    branchId: currentScript?.getAttribute('data-branch-id') || 'branch_koramangala',
    apiUrl: (currentScript?.getAttribute('data-api-url') || 'http://localhost:8080').replace(/\/$/, ''),
    wsUrl: (currentScript?.getAttribute('data-ws-url') || 'ws://localhost:8081').replace(/\/$/, ''),
    userRef: currentScript?.getAttribute('data-user-ref') || 'usr_cust_' + Math.random().toString(36).slice(2, 7),
    primaryColor: currentScript?.getAttribute('data-primary-color') || '#6366f1',
    lang: currentScript?.getAttribute('data-lang') || 'en-IN',
  };

  // State
  let sessionToken = null;
  let ws = null;
  let isOpen = false;
  let isListening = false;
  let recognition = null;
  let audioContext = null;
  let mediaStream = null;
  let isMuted = false;

  // Inject Styles into Head
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .vca-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, ${CONFIG.primaryColor}, #4f46e5);
      color: #ffffff;
      box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.5), 0 8px 10px -6px rgba(99, 102, 241, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 999998;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 2px solid rgba(255, 255, 255, 0.2);
    }
    .vca-fab:hover {
      transform: scale(1.08) translateY(-2px);
      box-shadow: 0 14px 28px -5px rgba(99, 102, 241, 0.6);
    }
    .vca-fab svg {
      width: 28px;
      height: 28px;
      fill: currentColor;
    }
    .vca-panel {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 48px);
      height: 560px;
      max-height: calc(100vh - 120px);
      background: #0f172a;
      color: #f8fafc;
      border-radius: 20px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      transform: translateY(20px) scale(0.95);
      opacity: 0;
      pointer-events: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .vca-panel.active {
      transform: translateY(0) scale(1);
      opacity: 1;
      pointer-events: all;
    }
    .vca-header {
      padding: 16px 20px;
      background: rgba(30, 41, 59, 0.8);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .vca-title {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vca-status-pill {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #14532d;
      color: #4ade80;
      font-weight: 600;
    }
    .vca-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 18px;
      padding: 4px;
      line-height: 1;
    }
    .vca-close:hover { color: #f8fafc; }
    .vca-chat {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }
    .vca-bubble {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 13.5px;
      line-height: 1.45;
    }
    .vca-bot {
      align-self: flex-start;
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-bottom-left-radius: 4px;
    }
    .vca-user {
      align-self: flex-end;
      background: linear-gradient(135deg, ${CONFIG.primaryColor}, #4f46e5);
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }
    .vca-proposal-card {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 12px;
      padding: 12px 14px;
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .vca-proposal-total {
      font-size: 16px;
      font-weight: 700;
      color: #34d399;
    }
    .vca-confirm-btn {
      background: #10b981;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .vca-confirm-btn:hover { background: #059669; }
    .vca-footer {
      padding: 12px 16px;
      background: rgba(30, 41, 59, 0.8);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .vca-mic-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    .vca-mic-btn {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #1e293b;
      border: 2px solid ${CONFIG.primaryColor};
      color: #ffffff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      transition: all 0.2s;
    }
    .vca-mic-btn.recording {
      background: #ef4444;
      border-color: #ef4444;
      animation: vca-pulse 1.4s infinite;
    }
    @keyframes vca-pulse {
      0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
      70% { box-shadow: 0 0 0 16px rgba(239, 68, 68, 0); }
      100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
    }
    .vca-input-row {
      display: flex;
      gap: 8px;
    }
    .vca-input {
      flex: 1;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 12px;
      color: #f8fafc;
      font-size: 13px;
      outline: none;
    }
    .vca-input:focus { border-color: ${CONFIG.primaryColor}; }
    .vca-send-btn {
      background: ${CONFIG.primaryColor};
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 0 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .vca-lang-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #94a3b8;
    }
    .vca-lang-btn {
      background: transparent;
      border: 1px solid #334155;
      color: #94a3b8;
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
    }
    .vca-lang-btn.active {
      border-color: ${CONFIG.primaryColor};
      color: #ffffff;
      background: rgba(99, 102, 241, 0.2);
    }
  `;
  document.head.appendChild(styleEl);

  // Create FAB
  const fab = document.createElement('div');
  fab.className = 'vca-fab';
  fab.setAttribute('title', 'Voice Shopping Assistant');
  fab.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
    </svg>
  `;
  document.body.appendChild(fab);

  // Create Panel
  const panel = document.createElement('div');
  panel.className = 'vca-panel';
  panel.innerHTML = `
    <div class="vca-header">
      <div class="vca-title">
        <span>🎙️ Voice Assistant</span>
        <span class="vca-status-pill" id="vcaStatusPill">Ready</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <button id="vcaMuteBtn" style="background:transparent; border:none; color:#94a3b8; cursor:pointer;" title="Mute/Unmute Voice">🔊</button>
        <button class="vca-close" id="vcaCloseBtn">&times;</button>
      </div>
    </div>
    <div class="vca-chat" id="vcaChat">
      <div class="vca-bubble vca-bot">
        Namaste! I am your AI Voice Assistant. You can speak or type in English, Hindi, or Hinglish to search items, customize your cart, or track orders.
      </div>
    </div>
    <div class="vca-footer">
      <div class="vca-mic-container">
        <button class="vca-mic-btn" id="vcaMicBtn" title="Hold or tap to speak">🎙️</button>
        <div style="font-size:12px; color:#94a3b8;" id="vcaPromptHint">Tap mic to speak</div>
      </div>
      <div class="vca-input-row">
        <input type="text" class="vca-input" id="vcaTextInput" placeholder="Type or edit what you said..." />
        <button class="vca-send-btn" id="vcaSendBtn">Send</button>
      </div>
      <div class="vca-lang-bar">
        <span>Language:</span>
        <div style="display:flex; gap:4px;">
          <button class="vca-lang-btn active" data-lang="en-IN">EN</button>
          <button class="vca-lang-btn" data-lang="hi-IN">हिन्दी</button>
          <button class="vca-lang-btn" data-lang="hinglish">Hinglish</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // References
  const chatBox = panel.querySelector('#vcaChat');
  const textInput = panel.querySelector('#vcaTextInput');
  const sendBtn = panel.querySelector('#vcaSendBtn');
  const micBtn = panel.querySelector('#vcaMicBtn');
  const promptHint = panel.querySelector('#vcaPromptHint');
  const closeBtn = panel.querySelector('#vcaCloseBtn');
  const statusPill = panel.querySelector('#vcaStatusPill');
  const muteBtn = panel.querySelector('#vcaMuteBtn');
  const langBtns = panel.querySelectorAll('.vca-lang-btn');

  // Toggle Panel
  fab.onclick = () => {
    isOpen = !isOpen;
    panel.classList.toggle('active', isOpen);
    if (isOpen && !sessionToken) {
      initSession();
    }
  };

  closeBtn.onclick = () => {
    isOpen = false;
    panel.classList.remove('active');
  };

  muteBtn.onclick = () => {
    isMuted = !isMuted;
    muteBtn.innerText = isMuted ? '🔇' : '🔊';
    if (isMuted && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  // Language buttons
  langBtns.forEach((btn) => {
    btn.onclick = () => {
      langBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      CONFIG.lang = btn.getAttribute('data-lang');
      if (recognition) {
        recognition.lang = CONFIG.lang === 'hi-IN' ? 'hi-IN' : 'en-IN';
      }
    };
  });

  function addMessage(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `vca-bubble ${role === 'user' ? 'vca-user' : 'vca-bot'}`;
    bubble.innerText = text;
    chatBox.appendChild(bubble);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function speakReply(text) {
    if (isMuted || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = CONFIG.lang === 'hi-IN' ? 'hi-IN' : 'en-IN';
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      // Audio speech output fallback
    }
  }

  // Session Initiation
  async function initSession() {
    statusPill.innerText = 'Connecting...';
    statusPill.style.background = '#854d0e';
    statusPill.style.color = '#fef08a';

    try {
      const res = await fetch(`${CONFIG.apiUrl}/v1/assistant/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: CONFIG.tenantId,
          userRef: CONFIG.userRef,
          branchId: CONFIG.branchId,
        }),
      });

      if (!res.ok) throw new Error('Session request failed');
      const data = await res.json();
      sessionToken = data.token;

      statusPill.innerText = 'Online';
      statusPill.style.background = '#14532d';
      statusPill.style.color = '#4ade80';

      initWebSocket();
    } catch (err) {
      statusPill.innerText = 'Offline';
      statusPill.style.background = '#7f1d1d';
      statusPill.style.color = '#fca5a5';
      console.warn('[VCA] Session initialization error:', err);
    }
  }

  // WebSocket Connection
  function initWebSocket() {
    try {
      ws = new WebSocket(`${CONFIG.wsUrl}/?token=${encodeURIComponent(sessionToken)}`);
      ws.binaryType = 'arraybuffer';

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          if (msg.type === 'transcript_partial') {
            textInput.value = msg.text;
          } else if (msg.type === 'transcript_final') {
            textInput.value = msg.text;
            addMessage('user', msg.text);
          } else if (msg.type === 'assistant_reply') {
            addMessage('bot', msg.replyText);
            speakReply(msg.replyText);
            if (msg.proposalId) {
              renderProposal(msg);
            }
          }
        }
      };

      ws.onclose = () => {
        statusPill.innerText = 'Disconnected';
      };
    } catch (e) {
      console.warn('[VCA] WebSocket error:', e);
    }
  }

  function renderProposal(proposal) {
    const formattedTotal = (proposal.proposalTotalMinor / 100).toFixed(2);
    const card = document.createElement('div');
    card.className = 'vca-proposal-card';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:700; color:#34d399; font-size:13px;">🛒 Proposed Order Preview</span>
        <span class="vca-proposal-total">INR ${formattedTotal}</span>
      </div>
      <div style="font-size:12.5px; color:#94a3b8;">${proposal.replyText}</div>
      <button class="vca-confirm-btn" id="vcaConfirmBtn_${proposal.proposalId}">
        ✓ Confirm & Add to Cart
      </button>
    `;
    chatBox.appendChild(card);
    chatBox.scrollTop = chatBox.scrollHeight;

    const confirmBtn = card.querySelector(`#vcaConfirmBtn_${proposal.proposalId}`);
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.innerText = 'Updating Cart...';
      try {
        const res = await fetch(`${CONFIG.apiUrl}/v1/cart/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ proposalId: proposal.proposalId }),
        });
        const data = await res.json();
        card.innerHTML = `
          <div style="font-weight:700; color:#34d399; font-size:13px;">✓ Cart Updated Successfully!</div>
          <div style="font-size:12px; color:#cbd5e1;">Final Total: ${data.currency} ${(data.totalMinor / 100).toFixed(2)}</div>
        `;
        speakReply('Your cart has been updated! Proceeding to checkout.');
        
        // Dispatch custom event to host website
        window.dispatchEvent(
          new CustomEvent('vca:order-confirmed', {
            detail: { proposalId: proposal.proposalId, result: data },
          }),
        );
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.innerText = 'Retry Confirm';
        alert('Confirmation failed: ' + err);
      }
    };
  }

  // Send Text
  function sendUserText() {
    const text = textInput.value.trim();
    if (!text) return;
    addMessage('user', text);
    textInput.value = '';

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text_input', text }));
    } else {
      // Fallback to REST turns
      fetch(`${CONFIG.apiUrl}/v1/assistant/turns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ utterance: text }),
      })
        .then((res) => res.json())
        .then((data) => {
          addMessage('bot', data.replyText);
          speakReply(data.replyText);
          if (data.proposalId) {
            renderProposal(data);
          }
        })
        .catch((err) => {
          addMessage('bot', 'Sorry, could not process request: ' + err.message);
        });
    }
  }

  sendBtn.onclick = sendUserText;
  textInput.onkeydown = (e) => {
    if (e.key === 'Enter') sendUserText();
  };

  // Speech Recognition & Microphone Setup
  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = CONFIG.lang === 'hi-IN' ? 'hi-IN' : 'en-IN';

      recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add('recording');
        promptHint.innerText = 'Listening... Speak now';
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'start_turn' }));
        }
      };

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        textInput.value = transcript;
      };

      recognition.onerror = (event) => {
        console.warn('[VCA] SpeechRecognition error:', event.error);
        stopListening();
      };

      recognition.onend = () => {
        stopListening();
        if (textInput.value.trim()) {
          sendUserText();
        }
      };
    }
  }

  function startListening() {
    if (recognition) {
      try {
        recognition.start();
        return;
      } catch (e) {
        // Recognition already started or error
      }
    }

    // Direct Web Audio fallback
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          mediaStream = stream;
          isListening = true;
          micBtn.classList.add('recording');
          promptHint.innerText = 'Recording audio...';
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'start_turn' }));
          }
        })
        .catch((err) => {
          alert('Microphone permission required: ' + err.message);
        });
    }
  }

  function stopListening() {
    isListening = false;
    micBtn.classList.remove('recording');
    promptHint.innerText = 'Tap mic to speak';
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {}
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop_turn' }));
    }
  }

  micBtn.onclick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  setupSpeechRecognition();

  // Expose API to window
  window.VoiceCommerceAssistant = {
    open: () => {
      isOpen = true;
      panel.classList.add('active');
      if (!sessionToken) initSession();
    },
    close: () => {
      isOpen = false;
      panel.classList.remove('active');
    },
    sendText: (text) => {
      textInput.value = text;
      sendUserText();
    },
    config: CONFIG,
  };
})();
