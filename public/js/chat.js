
document.addEventListener('DOMContentLoaded', () => {
  const sendBtn = document.getElementById('sendBtn');
  const input = document.getElementById('chatInput');
  const chatBody = document.getElementById('chatBody');
  const typingTpl = document.getElementById('typingIndicatorTemplate')?.content;
  const threadInput = document.getElementById('threadId');

  // Send button
  sendBtn.addEventListener('click', async () => {
    // build UI context
    const userContext = {
      userId: window.currentUserId || null,
      currentPage: window.location.pathname,
      activeChallenge: window.activeChallenge || null
    };

    const userMessage = input.value.trim();
    if (!userMessage) return;

    appendUserBubble(userMessage);
    input.value = '';

    // typing indicator (if template exists)
    let typingIndicator = null;
    if (typingTpl) {
      const node = typingTpl.querySelector('#typingIndicator')?.cloneNode(true);
      if (node) {
        typingIndicator = node;
        typingIndicator.style.display = 'flex';
        chatBody.appendChild(typingIndicator);
      }
    }

    chatBody.scrollTop = chatBody.scrollHeight;

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          userContext,               // <— added
          context: userContext       // <— keep for backward compatibility
        }),
        credentials: 'include'
      });

      const data = await response.json();
      if (typingIndicator) typingIndicator.remove();

      // Always render something (no silent failure if server returns {error} or no reply)
      if (!response.ok || !data?.reply) {
        appendAssistantBubble(data?.error || `HTTP ${response.status}`);
      } else {
        appendAssistantBubble(data.reply);
      }
    } catch (err) {
      console.error('💥 Chat error:', err);
      if (typingIndicator) typingIndicator.remove();
      appendAssistantBubble("Sorry, I'm having trouble connecting right now. Please try again later.");
    }
  });
});

// Assistant bubble (deterministic: binds container locally)
function appendAssistantBubble(text) {
  if (!text) return;

  const chatBody = document.getElementById('chatBody'); // <— bind here
  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex mt-2 align-items-start';
  wrapper.innerHTML = `
    <img src="./images/kai-real.png" alt="KAI – the AI kindness coach" class="rounded-circle flex-shrink-0 me-2" style="width: 35px; height: 35px;">
    <div class="bg-body-tertiary rounded-3 px-3 py-2 ms-2 flex-grow-1" style="max-width: calc(100% - 50px);">
      ${sanitizeHTML(text)}
    </div>
  `;
  chatBody.appendChild(wrapper);
  chatBody.scrollTop = chatBody.scrollHeight;
}

// User bubble (unchanged)
function appendUserBubble(text) {
  const pic = (typeof window !== 'undefined' && window.loggedInUserPicture) || '/images/nerdy-KAI.png';
  const html = `
    <div class="d-flex flex-row justify-content-end mb-4 pt-1">
      <div class="p-2 rounded-3 d-inline-block" style="background-color: #455a7c; color: white; max-width: 100%; min-width: 50px;" class="p-2 rounded-3 d-inline-block">
        <p class="small mb-0" style="color: white;">${sanitizeHTML(text)}</p>
      </div>
      <img
        src="${pic}"
        alt="get kinder user avatar"
        class="rounded-circle ms-2"
        style="width: 45px; height: 45px;"
        onerror="this.onerror=null; this.src='/images/nerdy-KAI.png';"
      >
    </div>
  `;
  document.getElementById('chatBody').insertAdjacentHTML('beforeend', html);
}

// Optional extra helper bubble (unchanged)
function appendKaiBubble(text) {
  if (!text) {
    console.error('⚠️ Empty assistant reply received.');
    return;
  }
  const chatBody = document.getElementById('chatBody');
  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex flex-row justify-content-start mb-4';
  wrapper.innerHTML = `
    <img src="/images/kai-real.png" alt="KAI" class="rounded-circle me-2" style="width: 45px; height: 45px;">
    <div class="bg-body-tertiary p-2 rounded-3" style="max-width: 85%; word-break: break-word;">
      <p class="small mb-0">${sanitizeHTML(text)}</p>
    </div>
  `;
  chatBody.appendChild(wrapper);
  chatBody.scrollTop = chatBody.scrollHeight;
}

// HTML sanitization (unchanged)
function sanitizeHTML(str) {
  if (!str) return '';
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

// Typing indicator helpers (unchanged)
function showTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.style.display = 'flex';
}
function hideTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.style.display = 'none';
}
