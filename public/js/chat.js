
document.addEventListener('DOMContentLoaded', () => {
  const sendBtn = document.getElementById('sendBtn');
  const input = document.getElementById('chatInput');
  const chatBody = document.getElementById('chatBody');
  const typingTpl = document.getElementById('typingIndicatorTemplate').content;
  const threadInput = document.getElementById("threadId");

   sendBtn.addEventListener('click', async () => {
    const userMessage = input.value.trim();
    if (!userMessage) return;

    appendUserBubble(userMessage);
    input.value = '';

   // inject our typing-dots template
   const typingIndicator = typingTpl
     .querySelector('#typingIndicator')
     .cloneNode(true);
   typingIndicator.style.display = 'flex';
   chatBody.appendChild(typingIndicator);

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
        credentials: 'include'
      });

      const data = await response.json();
      typingIndicator.remove();
      appendAssistantBubble(data.reply);
    } catch (err) {
      console.error('💥 Chat error:', err);
      typingIndicator.remove();
    }
  }); 
  
});

  function appendUserBubble(text) {
    const bubble = document.createElement('div');
    bubble.classList.add('user-bubble');
    bubble.innerText = text;
    chatBody.appendChild(bubble);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function appendAssistantBubble(text) {
    const bubble = document.createElement('div');
    bubble.classList.add('assistant-bubble');
    bubble.innerText = text;
    chatBody.appendChild(bubble);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

function appendUserBubble(text) {
  const html = `
    <div class="d-flex flex-row justify-content-end mb-4 pt-1">
      <div style="background-color: #455a7c; color: white; max-width: 100%; min-width: 50px;" class="p-2 rounded-3 d-inline-block">
        <p class="small mb-0" style="color: white;">${sanitizeHTML(text)}</p>
      </div>
      <img src="/images/nerdy-KAI.png" alt="you" class="rounded-circle ms-2" style="width: 45px; height: 45px;">
    </div>
  `;
  document.getElementById('chatBody').insertAdjacentHTML('beforeend', html);
}

function appendKaiBubble(text) {
  if (!text) {
    console.error("⚠️ Empty assistant reply received.");
    return;
  }

  const chatBody = document.getElementById('chatBody');
  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex flex-row justify-content-start mb-4';
  wrapper.innerHTML = `
    <img src="/images/kai.png" alt="KAI" class="rounded-circle me-2" style="width: 45px; height: 45px;">
    <div class="bg-body-tertiary p-2 rounded-3" style="max-width: 85%; word-break: break-word;">
      <p class="small mb-0">${sanitizeHTML(text)}</p>
    </div>
  `;

  chatBody.appendChild(wrapper);
  chatBody.scrollTop = chatBody.scrollHeight;
}

function sanitizeHTML(str) {
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

// ✅ Typing Indicator Controls
function showTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.style.display = 'flex';
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.style.display = 'none';
}

