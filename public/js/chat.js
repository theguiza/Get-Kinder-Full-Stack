
// ===========================
// BOLT CHANGELOG
// Date: 2025-01-27
// What: Enhanced chat.js with dashboard integration and improved KAI interaction
// Why: Support dashboard-specific chat functionality and better user experience
// ===========================

document.addEventListener('DOMContentLoaded', () => {
  const sendBtn = document.getElementById('sendBtn');
  const input = document.getElementById('chatInput');
  const chatBody = document.getElementById('chatBody');
  const typingTpl = document.getElementById('typingIndicatorTemplate').content;
  const threadInput = document.getElementById("threadId");

  // BOLT: KAI integration - Enhanced send button click handler
   sendBtn.addEventListener('click', async () => {
   // BOLT: KAI integration - Get user context for dashboard-specific interactions
   const userContext = {
     userId: window.currentUserId || null,
     currentPage: window.location.pathname,
     activeChallenge: window.activeChallenge || null
   };

    const userMessage = input.value.trim();
    if (!userMessage) return;

    appendUserBubble(userMessage);
    input.value = '';

    // BOLT: KAI integration - Show typing indicator if template exists
    let typingIndicator = null;
    if (typingTpl) {
      typingIndicator = typingTpl
        .querySelector('#typingIndicator')
        .cloneNode(true);
      typingIndicator.style.display = 'flex';
      chatBody.appendChild(typingIndicator);
    }

     chatBody.scrollTop = chatBody.scrollHeight;

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMessage,
          context: userContext 
        }),
        credentials: 'include'
      });

      const data = await response.json();
      if (typingIndicator) typingIndicator.remove();
      appendAssistantBubble(data.reply);
    } catch (err) {
      console.error('💥 Chat error:', err);
      if (typingIndicator) typingIndicator.remove();
      appendAssistantBubble('Sorry, I\'m having trouble connecting right now. Please try again later.');
    }
  }); 
  
});

// BOLT: KAI integration - Enhanced assistant bubble with better formatting
function appendAssistantBubble(text) {
  if (!text) return;

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

// BOLT: KAI integration - Enhanced user bubble with better error handling
function appendUserBubble(text) {

  // BOLT: KAI integration - Fallback for user picture
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

// BOLT: KAI integration - Additional KAI bubble function for consistency
function appendKaiBubble(text) {
  if (!text) {
    console.error("⚠️ Empty assistant reply received.");
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

// BOLT: KAI integration - Enhanced HTML sanitization
function sanitizeHTML(str) {
  if (!str) return '';
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

// BOLT: KAI integration - Typing Indicator Controls
function showTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.style.display = 'flex';
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.style.display = 'none';
}

