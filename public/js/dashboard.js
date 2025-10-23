// ===========================
// What: Dashboard client-side functionality for Morning Prompt modal
// Why: Handle modal interactions, API calls, and user actions
// ===========================

const csrfMeta = document.querySelector('meta[name="csrf-token"]');
const CSRF_TOKEN = csrfMeta && csrfMeta.content ? csrfMeta.content : '';

/**
 *Morning Prompt - Global variables for modal state
 */
let morningPromptData = null;
let isReflectionSaving = false;

/**
 * Morning Prompt - Open modal and fetch day content
 */
async function openMorningPrompt() {
    const modal = document.getElementById('morningPromptModal');
    const loadingElements = {
        dayTitle: document.getElementById('dayTitle'),
        principle: document.getElementById('principle'),
        body: document.getElementById('body'),
        suggestedActs: document.getElementById('suggestedActs'),
        reflection: document.getElementById('reflection')
    };

    //  UI change - Show modal immediately with loading state
    modal.classList.remove('hidden');
    
    //  UI change - Set loading states
    loadingElements.dayTitle.textContent = 'Loading...';
    loadingElements.principle.textContent = 'Loading principle...';
    loadingElements.body.textContent = 'Loading today\'s guidance...';
    loadingElements.suggestedActs.innerHTML = '<li>Loading suggestions...</li>';

    try {
        // API call - Fetch morning prompt data
        const response = await fetch('/dashboard/morning-prompt', {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        morningPromptData = await response.json();
        
        // UI change - Populate modal with fetched data
        populateMorningPrompt(morningPromptData);
        
    } catch (error) {
        console.error('Error fetching morning prompt:', error);
        
        // UI change - Show error state
        loadingElements.dayTitle.textContent = 'Error Loading Content';
        loadingElements.principle.textContent = 'Unable to load today\'s principle. Please try again.';
        loadingElements.body.textContent = 'There was an error loading your morning prompt.';
        loadingElements.suggestedActs.innerHTML = '<li>Unable to load suggestions</li>';
        
        // UI change - Show retry option
        setTimeout(() => {
            if (confirm('Failed to load morning prompt. Would you like to try again?')) {
                openMorningPrompt();
            } else {
                closeMorningPrompt();
            }
        }, 1000);
    }
}

/**
 * Morning Prompt - Populate modal with data
 * @param {Object} data - Morning prompt data from API
 */
function populateMorningPrompt(data) {
    //  UI change - Update day title
    document.getElementById('dayTitle').textContent = `Day ${data.dayNumber}: ${data.dayTitle}`;
    
    // UI change - Update principle
    document.getElementById('principle').textContent = data.principle;
    
    // UI change - Update body content
    document.getElementById('body').textContent = data.body;
    
    // UI change - Update suggested acts list
    const suggestedActsList = document.getElementById('suggestedActs');
    suggestedActsList.innerHTML = '';
    if (Array.isArray(data.suggestedActs) && data.suggestedActs.length > 0) {
        data.suggestedActs.forEach(act => {
            const li = document.createElement('li');
            li.textContent = String(act ?? '');
            suggestedActsList.appendChild(li);
        });
    } else {
        const fallbackItem = document.createElement('li');
        fallbackItem.textContent = 'No specific suggestions for today - follow your heart!';
        suggestedActsList.appendChild(fallbackItem);
    }
    
    // UI change - Pre-fill existing reflection if available
    const reflectionTextarea = document.getElementById('reflection');
    if (data.existingReflection) {
        reflectionTextarea.value = data.existingReflection;
    }
}

/**
 * Morning Prompt - Close modal
 */
function closeMorningPrompt() {
    const modal = document.getElementById('morningPromptModal');
    modal.classList.add('hidden');
    
    // UI change - Reset modal state
    morningPromptData = null;
    document.getElementById('reflection').value = '';
}

/**
 *  Reflection - Send reflection to KAI and save to database
 */
async function sendReflection() {
    if (isReflectionSaving) return;
    
    const reflectionText = document.getElementById('reflection').value.trim();
    const sendButton = document.getElementById('sendReflection');
    const buttonText = sendButton.querySelector('.btn-text');
    const buttonLoading = sendButton.querySelector('.btn-loading');
    
    if (!reflectionText) {
        alert('Please write a reflection before sending.');
        return;
    }
    
    // UI change - Show loading state
    isReflectionSaving = true;
    sendButton.classList.add('btn-loading');
    buttonText.classList.add('hidden');
    buttonLoading.classList.remove('hidden');
    sendButton.disabled = true;
    
    try {
        // API call - Save reflection
        const reflectionHeaders = {
            'Content-Type': 'application/json',
            ...(CSRF_TOKEN ? { 'X-CSRF-Token': CSRF_TOKEN } : {})
        };
        const response = await fetch('/dashboard/reflect', {
            method: 'POST',
            headers: reflectionHeaders,
            credentials: 'include',
            body: JSON.stringify({
                reflection: reflectionText
            })
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            //UI change - Show success feedback
            showNotification('Reflection saved successfully! 💭', 'success');
            
            // UI change - Update button to show saved state
            buttonText.textContent = 'Reflection Saved ✓';
            buttonText.classList.remove('hidden');
            buttonLoading.classList.add('hidden');
            sendButton.style.background = '#10b981';
            
        } else {
            throw new Error(result.error || 'Failed to save reflection');
        }
        
    } catch (error) {
        console.error('Error saving reflection:', error);
        
        // UI change - Show error feedback
        showNotification('Failed to save reflection. Please try again.', 'error');
        
        // UI change - Reset button state
        buttonText.classList.remove('hidden');
        buttonLoading.classList.add('hidden');
        
    } finally {
        // UI change - Reset loading state
        isReflectionSaving = false;
        sendButton.classList.remove('btn-loading');
        sendButton.disabled = false;
    }
}

/**
 * Progress - Mark current day as done
 */
async function markDayDone() {
    const markButton = document.getElementById('markDone');
    const originalText = markButton.textContent;
    
    //  UI change - Confirm action
    if (!confirm('Are you sure you want to mark today as completed? This action cannot be undone.')) {
        return;
    }
    
    // UI change - Show loading state
    markButton.textContent = 'Marking as Done...';
    markButton.disabled = true;
    
    try {
        //  API call - Mark day as done
        const markDoneHeaders = {
            'Content-Type': 'application/json',
            ...(CSRF_TOKEN ? { 'X-CSRF-Token': CSRF_TOKEN } : {})
        };
        const response = await fetch('/dashboard/mark-done', {
            method: 'POST',
            headers: markDoneHeaders,
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            if (result.challengeCompleted) {
                // UI change - Challenge completed celebration
                showNotification('🎉 Congratulations! You completed the entire challenge!', 'success');
                setTimeout(() => {
                    closeMorningPrompt();
                    window.location.reload();
                }, 2000);
            } else {
                // UI change - Day completed, advance to next
                showNotification(`Great job! Moving to day ${result.newDay} 🌟`, 'success');
                setTimeout(() => {
                    closeMorningPrompt();
                    window.location.reload();
                }, 1500);
            }
        } else {
            throw new Error(result.error || 'Failed to mark day as done');
        }
        
    } catch (error) {
        console.error('Error marking day as done:', error);
        showNotification('Failed to mark day as done. Please try again.', 'error');
        
        // UI change - Reset button state
        markButton.textContent = originalText;
        markButton.disabled = false;
    }
}

/**
 *  UI change - Show notification to user
 * @param {string} message - Notification message
 * @param {string} type - Notification type ('success', 'error', 'info')
 */
function showNotification(message, type = 'info') {
    //  UI change - Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.setAttribute('role', 'status');
    notification.setAttribute('aria-live', 'polite');
    notification.textContent = message;
    
    // UI change - Style notification
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '16px 24px',
        borderRadius: '8px',
        color: 'white',
        fontWeight: '500',
        zIndex: '3000',
        maxWidth: '400px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        transform: 'translateX(100%)',
        transition: 'transform 0.3s ease'
    });
    
    // UI change - Set background color based on type
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        info: '#3b82f6'
    };
    notification.style.background = colors[type] || colors.info;
    
    //  UI change - Add to page and animate in
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // UI change - Auto-remove after delay
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

/**
 * UI change - Initialize dashboard functionality when DOM loads
 */
document.addEventListener('DOMContentLoaded', function() {
    //Morning Prompt - Bind reflection send button
    const sendReflectionBtn = document.getElementById('sendReflection');
    if (sendReflectionBtn) {
        sendReflectionBtn.addEventListener('click', sendReflection);
    }
    
    // Progress - Bind mark done button
    const markDoneBtn = document.getElementById('markDone');
    if (markDoneBtn) {
        markDoneBtn.addEventListener('click', markDayDone);
    }
    
    //  UI change - Close modal on escape key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            const modal = document.getElementById('morningPromptModal');
            if (modal && !modal.classList.contains('hidden')) {
                closeMorningPrompt();
            }
        }
    });
    
    //  UI change - Animate progress bars on load with brand colors
    const progressBars = document.querySelectorAll('.progress-fill');
    progressBars.forEach(bar => {
        const width = bar.style.width;
        bar.style.width = '0%';
        setTimeout(() => {
            bar.style.width = width;
        }, 500);
    });
});

/**
 * KAI integration - Enhanced askKAI function for dashboard context
 * @param {string} message - Message to send to KAI
 */
function askKAI(message) {
    // KAI integration - Add challenge context if available
    let contextualMessage = message;
    if (morningPromptData) {
        contextualMessage = `Context: I'm on Day ${morningPromptData.dayNumber} of my challenge "${morningPromptData.challengeName}". ${message}`;
    }
    
    // KAI integration - Open chat and send message
    if (!chatOpen) toggleChat();
    document.getElementById('chatInput').value = contextualMessage;
    sendMessage();
}
