// public/js/chat.js (REPLACE ENTIRE FILE)

document.addEventListener('DOMContentLoaded', () => {
    const chatBody = document.getElementById('chatBody');
    const chatForm = document.querySelector('form'); // Your form doesn't have an ID, so we grab it by tag
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const typingTpl = document.getElementById('typingIndicatorTemplate').content;

    // --- Session State Management ---
    let chatSessionId = localStorage.getItem('chatSessionId');
    let threadId = localStorage.getItem('threadId');

    // --- Helper Functions from your file (kept the same) ---
    function sanitizeHTML(str) {
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }

    // --- Modified Helper Functions ---
    const appendBubble = (message, isUser = false) => {
        if (!message || message.trim() === '') return;

        const wrapper = document.createElement('div');
        wrapper.className = 'd-flex mt-2 align-items-start';

        if (isUser) {
            const pic = window.loggedInUserPicture || '/images/nerdy-KAI.png';
            wrapper.classList.add('justify-content-end');
            wrapper.innerHTML = `
                <div class="p-2 rounded-3" style="background-color: #455a7c; color: white; max-width: 85%;">
                    <p class="small mb-0">${sanitizeHTML(message)}</p>
                </div>
                <img src="${pic}" alt="User Avatar" class="rounded-circle ms-2" style="width: 45px; height: 100%;" onerror="this.onerror=null; this.src='/images/nerdy-KAI.png';">
            `;
        } else {
            wrapper.innerHTML = `
                <img src="/images/kai-real.png" alt="KAI" class="rounded-circle me-2" style="width: 45px; height: 100%;">
                <div class="bg-body-tertiary p-2 rounded-3" style="max-width: 85%; word-break: break-word;">
                    <p class="small mb-0">${sanitizeHTML(message)}</p>
                </div>
            `;
        }
        chatBody.appendChild(wrapper);
        chatBody.scrollTop = chatBody.scrollHeight;
    };

    const showTypingIndicator = (show = true) => {
        let indicator = document.getElementById('typingIndicator');
        if (show && !indicator) {
            indicator = typingTpl.querySelector('.d-flex').cloneNode(true);
            indicator.id = 'typingIndicator';
            chatBody.appendChild(indicator);
            chatBody.scrollTop = chatBody.scrollHeight;
        } else if (!show && indicator) {
            indicator.remove();
        }
    };


    // --- Core Logic ---
    const startChatSession = async () => {
        try {
            const response = await fetch('/api/chat/start', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to start a new session');
            const data = await response.json();
            chatSessionId = data.chatSessionId;
            threadId = data.threadId;
            localStorage.setItem('chatSessionId', chatSessionId);
            localStorage.setItem('threadId', threadId);
            appendBubble('👋 Hello! I’m KAI, your Kindness-AI Companion. How can I help you today?');
        } catch (error) {
            appendBubble('Could not start a chat session. Please refresh the page.');
            console.error(error);
        }
    };

    const handleSendMessage = async () => {
        const message = chatInput.value.trim();
        if (!message || !chatSessionId || !threadId) return;
        appendBubble(message, true);
        chatInput.value = '';
        showTypingIndicator(true);

        try {
            const response = await fetch('/api/chat/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, threadId, chatSessionId })
            });
            if (!response.ok) throw new Error('Server returned an error');
            const data = await response.json();
            showTypingIndicator(false);
            appendBubble(data.reply);
        } catch (error) {
            showTypingIndicator(false);
            appendBubble('Sorry, I had trouble connecting. Please try again.');
            console.error(error);
        }
    };

    // --- Event Listeners ---
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSendMessage();
    });
    sendBtn.addEventListener('click', handleSendMessage);

    // --- Initialization ---
    if (!chatSessionId || !threadId) {
        startChatSession();
    } else {
        appendBubble('👋 Welcome back! Let\'s continue our conversation.');
    }

    // Keep your keyboard handling logic from the original file
    (function() {
      let prevHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      function scrollChatToBottom() {
        if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
        document.getElementById('chat-card-container')?.scrollIntoView({ block: 'end', behavior: 'smooth' });
      }
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          const curr = window.visualViewport.height;
          if (curr > prevHeight + 10) scrollChatToBottom();
          prevHeight = curr;
        });
      }
      chatInput.addEventListener('blur', () => setTimeout(scrollChatToBottom, 50));
    })();
});