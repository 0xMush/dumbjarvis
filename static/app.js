(function() {
  'use strict';

  let currentSessionId = null;
  let ws = null;
  let isStreaming = false;
  let talkMode = false;
  let recognition = null;
  let isListening = false;
  let attachedContent = null;
  let streamBuffer = '';
  let settings = {
    model: 'openai/gpt-oss-20b:free',
    confirmDestructive: true,
    talkDefault: false,
  };
  let toolCallStack = [];

  const chatWindow = document.getElementById('chatWindow');
  const inputBox = document.getElementById('inputBox');
  const sendBtn = document.getElementById('sendBtn');
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
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsDrawer = document.getElementById('settingsDrawer');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsModel = document.getElementById('settingsModel');
  const confirmSwitch = document.getElementById('confirmSwitch');
  const talkSwitch = document.getElementById('talkSwitch');

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

  // Talk mode
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      inputBox.value = transcript;
      isListening = false;
      voiceIndicator.classList.remove('active');
      sendMessage();
    };
    recognition.onerror = () => {
      isListening = false;
      voiceIndicator.classList.remove('active');
    };
    recognition.onend = () => {
      isListening = false;
      voiceIndicator.classList.remove('active');
    };
  }

  talkBtn.addEventListener('click', () => {
    if (!recognition) {
      alert('Speech recognition not supported in this browser. Try Chrome.');
      return;
    }
    talkMode = !talkMode;
    talkBtn.classList.toggle('active', talkMode);
    if (talkMode) startListening();
    else stopListening();
  });

  function startListening() {
    if (isListening || !recognition) return;
    isListening = true;
    voiceIndicator.classList.add('active');
    voiceDot.className = 'voice-dot listening';
    voiceText.textContent = 'Listening...';
    recognition.start();
  }

  function stopListening() {
    if (recognition) recognition.stop();
    isListening = false;
    voiceIndicator.classList.remove('active');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      if (recognition && !talkMode) {
        e.preventDefault();
        startListening();
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      if (isListening) {
        e.preventDefault();
        stopListening();
        const text = inputBox.value.trim();
        if (text) sendMessage();
      }
    }
  });

  // Settings
  settingsBtn.addEventListener('click', () => {
    settingsDrawer.classList.toggle('open');
    settingsOverlay.classList.toggle('open');
  });

  settingsOverlay.addEventListener('click', () => {
    settingsDrawer.classList.remove('open');
    settingsOverlay.classList.remove('open');
  });

  settingsModel.addEventListener('change', () => { settings.model = settingsModel.value; });
  confirmSwitch.addEventListener('click', () => {
    settings.confirmDestructive = !settings.confirmDestructive;
    confirmSwitch.classList.toggle('on', settings.confirmDestructive);
  });
  talkSwitch.addEventListener('click', () => {
    settings.talkDefault = !settings.talkDefault;
    talkSwitch.classList.toggle('on', settings.talkDefault);
  });

  // TTS
  function speak(text) {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    voiceDot.className = 'voice-dot speaking';
    voiceText.textContent = 'Speaking...';
    voiceIndicator.classList.add('active');
    utterance.onend = () => voiceIndicator.classList.remove('active');
    utterance.onerror = () => voiceIndicator.classList.remove('active');
    speechSynthesis.speak(utterance);
  }

  async function init() {
    await loadSessions();
    await createNewSession();
  }

  init();

  window.jarvis = { speak, connect, loadSessions, createNewSession };
})();
