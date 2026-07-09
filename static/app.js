(function() {
  'use strict';

  let currentSessionId = null;
  let ws = null;
  let isStreaming = false;
  let talkMode = false;
  let autoSend = true;
  let recognition = null;
  let isListening = false;
  let attachedContent = null;
  let streamBuffer = '';
  let ttsVoices = [];
  let ttsReady = false;
  let settings = {
    confirmDestructive: true,
    talkDefault: false,
  };
  let toolCallStack = [];

  const chatWindow = document.getElementById('chatWindow');
  const inputBox = document.getElementById('inputBox');
  const sendBtn = document.getElementById('sendBtn');
  const micBtn = document.getElementById('micBtn');
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('fileInput');
  const attachPreview = document.getElementById('attachPreview');
  const attachName = document.getElementById('attachName');
  const removeAttach = document.getElementById('removeAttach');
  const sessionList = document.getElementById('sessionList');
  const newSessionBtn = document.getElementById('newSessionBtn');
  const chatHeader = document.getElementById('chatHeader');
  const typing = document.getElementById('typing');
  const talkBtn = document.getElementById('talkBtn');
  const voiceIndicator = document.getElementById('voiceIndicator');
  const voiceDot = document.getElementById('voiceDot');
  const voiceText = document.getElementById('voiceText');
  const liveTranscript = document.getElementById('liveTranscript');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsDrawer = document.getElementById('settingsDrawer');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const confirmSwitch = document.getElementById('confirmSwitch');
  const talkSwitch = document.getElementById('talkSwitch');
  const autoSendSwitch = document.getElementById('autoSendSwitch');

  const markdownOpts = { breaks: true, gfm: true };

  function scrollBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    return marked.parse(text, markdownOpts);
  }

  function getOrCreateMessageContainer(role) {
    let lastMsg = chatWindow.lastElementChild;
    if (!lastMsg || !lastMsg.classList.contains(role) || lastMsg.classList.contains('tool-call-wrapper')) {
      const div = document.createElement('div');
      div.className = `message ${role}`;
      const header = document.createElement('div');
      header.className = 'message-header';
      header.innerHTML = `<span class="message-label">${role}</span>`;
      div.appendChild(header);
      const body = document.createElement('div');
      body.className = 'message-content';
      div.appendChild(body);
      chatWindow.appendChild(div);
      lastMsg = div;
    }
    return lastMsg.querySelector('.message-content');
  }

  function addMessageToChat(role, content, timestamp) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    const header = document.createElement('div');
    header.className = 'message-header';
    header.innerHTML = `<span class="message-label">${role}</span><span class="message-timestamp">${formatTime(timestamp)}</span>`;
    div.appendChild(header);
    const body = document.createElement('div');
    body.className = 'message-content';
    body.innerHTML = renderMarkdown(content);
    div.appendChild(body);
    chatWindow.appendChild(div);
    scrollBottom();
    return body;
  }

  function addToolCall(tool, args) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tool-call-wrapper message assistant';
    const badge = document.createElement('div');
    badge.className = 'tool-call';
    const header = document.createElement('div');
    header.className = 'tool-call-header';
    header.innerHTML = `<span class="arrow">▸</span><span>🔧 ${tool}: ${escapeHtml(JSON.stringify(args))}</span>`;
    const resultDiv = document.createElement('div');
    resultDiv.className = 'tool-call-result';
    header.addEventListener('click', () => {
      header.querySelector('.arrow').classList.toggle('open');
      resultDiv.classList.toggle('open');
    });
    badge.appendChild(header);
    badge.appendChild(resultDiv);
    wrapper.appendChild(badge);
    chatWindow.appendChild(wrapper);
    scrollBottom();
    return resultDiv;
  }

  function showTyping(show) {
    typing.classList.toggle('active', show);
    scrollBottom();
  }

  function clearChat() {
    chatWindow.innerHTML = '';
    toolCallStack = [];
    streamBuffer = '';
  }

  function stopSpeaking() {
    if (window.speechSynthesis && speechSynthesis.speaking) {
      speechSynthesis.cancel();
      voiceIndicator.classList.remove('active');
    }
  }

  function speakText(text) {
    if (!talkMode || !window.speechSynthesis) return;
    if (!ttsReady) {
      console.warn('TTS not ready — no voices available');
      return;
    }
    const plain = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[#*_~>\[\]]+/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) return;
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.rate = 1.35;
    utterance.pitch = 1.05;
    utterance.volume = 1.0;
    const preferred = ttsVoices.find(v =>
      /Google UK English Male|Microsoft David|Daniel|Google US English|Microsoft Mark|Microsoft Zira/.test(v.name)
    );
    if (preferred) utterance.voice = preferred;
    voiceDot.className = 'voice-dot speaking';
    voiceText.textContent = 'Speaking... (click 🎤 to stop)';
    voiceIndicator.classList.add('active');
    utterance.onend = () => voiceIndicator.classList.remove('active');
    utterance.onerror = (e) => {
      console.error('TTS error:', e);
      voiceIndicator.classList.remove('active');
    };
    setTimeout(() => speechSynthesis.speak(utterance), 50);
  }

  // WebSocket
  function connect(sessionId) {
    if (ws) {
      ws.close();
      ws = null;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/${sessionId}`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      if (currentSessionId !== sessionId) {
        currentSessionId = sessionId;
        ws.send(JSON.stringify({ type: 'load' }));
      }
    };
    ws.onmessage = (e) => handleWsMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (isStreaming) {
        isStreaming = false;
        showTyping(false);
      }
    };
    ws.onerror = () => {};
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'session_data':
        loadSessionIntoUI(msg.session);
        break;
      case 'session_created':
        currentSessionId = msg.id;
        loadSessions();
        chatHeader.textContent = `Session: ${msg.id}`;
        clearChat();
        break;
      case 'chunk':
        isStreaming = true;
        showTyping(false);
        streamBuffer += msg.content;
        getOrCreateMessageContainer('assistant').innerHTML = renderMarkdown(streamBuffer);
        scrollBottom();
        break;
      case 'text':
        isStreaming = false;
        showTyping(false);
        if (msg.content) {
          streamBuffer = msg.content;
          getOrCreateMessageContainer('assistant').innerHTML = renderMarkdown(msg.content);
          scrollBottom();
        }
        break;
      case 'tool_call':
        isStreaming = true;
        showTyping(false);
        toolCallStack.push(addToolCall(msg.tool, msg.args));
        break;
      case 'tool_result':
        {
          const resultDiv = toolCallStack.pop();
          if (resultDiv) resultDiv.textContent = msg.result;
        }
        break;
      case 'done':
        isStreaming = false;
        showTyping(false);
        if (talkMode && msg.content) {
          speakText(msg.content);
        }
        toolCallStack = [];
        streamBuffer = '';
        loadSessions();
        break;
      case 'error':
        isStreaming = false;
        showTyping(false);
        streamBuffer = '';
        getOrCreateMessageContainer('assistant').innerHTML = renderMarkdown(`**Error:** ${escapeHtml(msg.content)}`);
        scrollBottom();
        break;
    }
    scrollBottom();
  }

  function loadSessionIntoUI(session) {
    clearChat();
    chatHeader.textContent = session.title || session.id;
    session.messages.forEach(m => addMessageToChat(m.role, m.content, m.timestamp));
    scrollBottom();
  }

  // Sessions
  async function loadSessions() {
    try {
      const r = await fetch('/api/sessions');
      renderSessionList(await r.json());
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  }

  function renderSessionList(sessions) {
    sessionList.innerHTML = '';
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let lastDate = null;
    sessions.forEach(s => {
      const date = (s.created || '').slice(0, 10);
      let label = date === today ? 'Today' : date === yesterday ? 'Yesterday' : date;
      if (label !== lastDate) {
        const h = document.createElement('div');
        h.className = 'session-date-header';
        h.textContent = label;
        sessionList.appendChild(h);
        lastDate = label;
      }
      const item = document.createElement('div');
      item.className = 'session-item';
      if (s.id === currentSessionId) item.classList.add('active');
      item.dataset.id = s.id;
      const title = document.createElement('div');
      title.className = 'session-item-title';
      title.textContent = s.title || 'Untitled';
      item.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'session-item-meta';
      meta.textContent = `${s.message_count} msg · ${formatTime(s.created)}`;
      item.appendChild(meta);
      item.addEventListener('click', () => {
        connect(s.id);
        document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
      });
      sessionList.appendChild(item);
    });
  }

  async function sendMessage() {
    let text = inputBox.value.trim();
    if (!text && !attachedContent) return;
    if (isStreaming) return;
    if (!currentSessionId) await createNewSession();
    if (!currentSessionId) return;
    if (attachedContent) {
      text = `${attachedContent}\n\n${text}`;
      attachedContent = null;
      attachPreview.classList.remove('active');
    }
    if (!text) return;
    stopSpeaking();
    inputBox.value = '';
    addMessageToChat('user', text);
    showTyping(true);
    ws.send(JSON.stringify({ type: 'message', content: text }));
    isStreaming = true;
  }

  async function createNewSession() {
    try {
      const r = await fetch('/api/sessions/new', { method: 'POST' });
      const data = await r.json();
      currentSessionId = data.id;
      clearChat();
      chatHeader.textContent = `Session: ${data.id}`;
      connect(data.id);
      loadSessions();
      return data.id;
    } catch (e) {
      console.error('Failed to create session:', e);
    }
  }

  // File attach
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await r.json();
      attachedContent = data.content;
      attachName.textContent = `📎 ${data.filename}`;
      attachPreview.classList.add('active');
    } catch (err) {
      console.error('Upload failed:', err);
    }
    fileInput.value = '';
  });

  removeAttach.addEventListener('click', () => {
    attachedContent = null;
    attachPreview.classList.remove('active');
  });

  inputBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);
  newSessionBtn.addEventListener('click', createNewSession);

  // Talk mode — mic button starts/stops listening
  micBtn.addEventListener('click', (e) => {
    if (speechSynthesis && speechSynthesis.speaking) {
      stopSpeaking();
    }
    if (isListening) {
      if (recognition) recognition.stop();
    } else {
      initTTSOnUserGesture(e);
      startListening();
    }
  });

  talkBtn.addEventListener('click', (e) => {
    talkMode = !talkMode;
    talkBtn.classList.toggle('active', talkMode);
    if (!talkMode) {
      if (isListening && recognition) recognition.stop();
      stopListeningUI();
      stopSpeaking();
      liveTranscript.textContent = '';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      stopSpeaking();
      if (isListening && recognition) {
        recognition.stop();
      }
    }
  });

  function startListening() {
    if (isListening) return;
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      addMessageToChat('assistant', '**Error:** Speech recognition not supported. Use Chrome.');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
      if (recognition) {
        try { recognition.abort(); } catch (_) {}
        recognition = null;
      }
      recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      let finalTranscript = '';

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        if (final) {
          finalTranscript += final;
          inputBox.value = finalTranscript;
          liveTranscript.textContent = '';
          if (autoSend) {
            if (recognition) { try { recognition.stop(); } catch(_) {} }
          } else {
            liveTranscript.textContent = '\u00A0';
          }
        } else {
          liveTranscript.textContent = interim || '\u00A0';
          liveTranscript.style.opacity = '1';
        }
      };

      recognition.onerror = (e) => {
        console.error('STT error:', e.error);
        if (e.error === 'not-allowed') {
          addMessageToChat('assistant', '**Error:** Microphone access denied. Allow mic permission and refresh.');
        } else if (e.error === 'no-speech') {
          liveTranscript.textContent = '[no speech detected]';
          setTimeout(() => { if (!isListening && liveTranscript) liveTranscript.textContent = ''; }, 2000);
        }
        stopListeningUI();
      };

      recognition.onend = () => {
        const text = finalTranscript.trim();
        if (text && !autoSend) {
          inputBox.value = text;
          liveTranscript.textContent = '';
        } else if (text && autoSend && !inputBox.value) {
          inputBox.value = text;
          liveTranscript.textContent = '';
          sendMessage();
        } else if (text && autoSend && inputBox.value) {
          sendMessage();
        } else {
          liveTranscript.textContent = '';
        }
        finalTranscript = '';
        stopListeningUI();
      };

      isListening = true;
      micBtn.classList.add('listening');
      micBtn.textContent = '⏹';
      voiceIndicator.classList.add('active');
      voiceDot.className = 'voice-dot listening';
      voiceText.textContent = 'Listening...';
      liveTranscript.textContent = '\u00A0';
      liveTranscript.style.opacity = '1';
      recognition.start();
    } catch (e) {
      console.error('STT start failed:', e);
      stopListeningUI();
    }
  }

  function stopListeningUI() {
    isListening = false;
    recognition = null;
    micBtn.classList.remove('listening');
    micBtn.textContent = '🎤';
    if (!liveTranscript.textContent.trim() || liveTranscript.textContent === '\u00A0') {
      liveTranscript.textContent = '';
      liveTranscript.style.opacity = '0';
    }
    voiceIndicator.classList.remove('active');
  }

  // TTS — init on first user gesture
  function initTTSOnUserGesture(e) {
    if (ttsReady) return;
    if (!window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance('');
      speechSynthesis.speak(u);
      speechSynthesis.cancel();
      ttsVoices = speechSynthesis.getVoices();
      if (ttsVoices.length === 0) {
        speechSynthesis.onvoiceschanged = () => {
          ttsVoices = speechSynthesis.getVoices();
          if (ttsVoices.length > 0) ttsReady = true;
        };
      } else {
        ttsReady = true;
      }
    } catch (e) {
      console.warn('TTS init failed:', e);
    }
  }

  // Settings
  settingsBtn.addEventListener('click', () => {
    settingsDrawer.classList.toggle('open');
    settingsOverlay.classList.toggle('open');
  });

  settingsOverlay.addEventListener('click', () => {
    settingsDrawer.classList.remove('open');
    settingsOverlay.classList.remove('open');
  });

  confirmSwitch.addEventListener('click', () => {
    settings.confirmDestructive = !settings.confirmDestructive;
    confirmSwitch.classList.toggle('on', settings.confirmDestructive);
  });
  talkSwitch.addEventListener('click', () => {
    settings.talkDefault = !settings.talkDefault;
    talkSwitch.classList.toggle('on', settings.talkDefault);
  });
  autoSendSwitch.addEventListener('click', () => {
    autoSend = !autoSend;
    autoSendSwitch.classList.toggle('on', autoSend);
  });

  async function init() {
    if ('speechSynthesis' in window) {
      ttsVoices = speechSynthesis.getVoices();
      if (ttsVoices.length > 0) ttsReady = true;
      speechSynthesis.onvoiceschanged = () => {
        ttsVoices = speechSynthesis.getVoices();
        if (ttsVoices.length > 0) ttsReady = true;
      };
    }
    await loadSessions();
    await createNewSession();
  }

  init();

  window.jarvis = { speak: speakText, connect, loadSessions, createNewSession };
})();
