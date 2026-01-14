// AI Text Summarizer Content Script
// Handles user interactions and UI rendering on web pages

(function() {
  'use strict';

  // Configuration constants
  const DEBOUNCE_DELAY = 150; // ms to debounce selection events
  const MAX_POPUP_WIDTH = 300;
  const ICON_SIZE = 32;

  // State variables (scoped to avoid globals)
  let floatingIcon = null;
  let summarizePopup = null;
  let currentSelection = '';
  let isPopupVisible = false;
  let debounceTimer = null;
  let isRequestInProgress = false;

  // API Key for backend communication
  const API_KEY = 'AIzaSyDdMdhJV-sQNft8ZdliIMP465JM4P7Y4Ns';

  // Inject CSS styles
  function injectStyles() {
    if (document.getElementById('ai-summarize-styles')) return;

    const link = document.createElement('link');
    link.id = 'ai-summarize-styles';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content.css');
    document.head.appendChild(link);
  }

  // Create and inject UI elements
  function createUIElements() {
    // Floating icon
    floatingIcon = document.createElement('div');
    floatingIcon.className = 'ai-summarize-icon';
    floatingIcon.innerHTML = '🤖';
    floatingIcon.title = 'Summarize text'; // Tooltip
    floatingIcon.style.display = 'none';
    document.body.appendChild(floatingIcon);

    // Summarize popup
    summarizePopup = document.createElement('div');
    summarizePopup.className = 'ai-summarize-popup';
    summarizePopup.innerHTML = `
      <textarea id="summarize-text" placeholder="Selected text..." maxlength="3000"></textarea>
      <div class="options">
        <label><input type="radio" name="summary-type" value="short" checked> Short Summary</label>
        <label><input type="radio" name="summary-type" value="medium"> Medium Summary</label>
        <label><input type="radio" name="summary-type" value="bullet"> Bullet Summary</label>
      </div>
      <button id="summarize-btn">
        <span class="btn-text">Summarize</span>
        <span class="spinner" style="display: none;">⏳</span>
      </button>
      <div id="summarize-result" class="result"></div>
    `;
    document.body.appendChild(summarizePopup);
  }

  // Position floating icon near selection
  function positionFloatingIcon(range) {
    const rect = range.getBoundingClientRect();
    let left = rect.left + window.scrollX + rect.width / 2 - ICON_SIZE / 2;
    let top = rect.bottom + window.scrollY + 10;

    // Ensure icon stays within viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left < 0) left = 0;
    if (left + ICON_SIZE > viewportWidth) left = viewportWidth - ICON_SIZE;
    if (top + ICON_SIZE > window.scrollY + viewportHeight) {
      top = rect.top + window.scrollY - ICON_SIZE - 10; // Above selection
    }

    floatingIcon.style.left = `${left}px`;
    floatingIcon.style.top = `${top}px`;
    floatingIcon.style.display = 'flex';
    setTimeout(() => floatingIcon.classList.add('show'), 10);
  }

  // Position popup near icon
  function positionPopup() {
    const iconRect = floatingIcon.getBoundingClientRect();
    let left = iconRect.left + window.scrollX;
    let top = iconRect.bottom + window.scrollY + 10;

    // Ensure popup stays within viewport
    const popupRect = summarizePopup.getBoundingClientRect();
    const viewportWidth = window.innerWidth + window.scrollX;
    const viewportHeight = window.innerHeight + window.scrollY;

    if (left + MAX_POPUP_WIDTH > viewportWidth) {
      left = viewportWidth - MAX_POPUP_WIDTH - 10;
    }
    if (top + popupRect.height > viewportHeight) {
      top = iconRect.top + window.scrollY - popupRect.height - 10;
    }

    summarizePopup.style.left = `${left}px`;
    summarizePopup.style.top = `${top}px`;
  }

  // Show floating icon
  function showFloatingIcon(range) {
    positionFloatingIcon(range);
  }

  // Hide floating icon
  function hideFloatingIcon() {
    if (!floatingIcon) return;
    floatingIcon.classList.remove('show');
    setTimeout(() => {
      floatingIcon.style.display = 'none';
      hidePopup();
    }, 200);
  }

  // Show popup
  function showPopup() {
    positionPopup();
    summarizePopup.classList.add('show');
    isPopupVisible = true;
    document.getElementById('summarize-text').value = currentSelection;
    document.getElementById('summarize-text').focus();
  }

  // Hide popup
  function hidePopup() {
    if (!summarizePopup) return;
    summarizePopup.classList.remove('show');
    isPopupVisible = false;
    resetUI();
  }

  // Reset UI elements
  function resetUI() {
    const resultEl = document.getElementById('summarize-result');
    const btn = document.getElementById('summarize-btn');
    const spinner = btn.querySelector('.spinner');
    const btnText = btn.querySelector('.btn-text');

    if (resultEl) resultEl.textContent = '';
    if (spinner) spinner.style.display = 'none';
    if (btnText) btnText.textContent = 'Summarize';
    isRequestInProgress = false;
  }

  // Add smart text/code detection logic
  function isCodeSelection(selection) {
    const parentElement = selection.anchorNode.parentElement;
    return (
      parentElement.tagName === 'CODE' ||
      parentElement.tagName === 'PRE' ||
      window.getComputedStyle(parentElement).fontFamily.includes('monospace')
    );
  }

  // Update the floating icon tooltip dynamically
  function updateIconTooltip(isCode) {
    floatingIcon.title = isCode ? 'Explain code' : 'Summarize text';
  }

  // Helper function to show toast notifications
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'ai-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('visible');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Improved copy action with fallback
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard!');
    }).catch(() => {
      // Fallback for clipboard API failure
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showToast('Copied to clipboard!');
      } catch (err) {
        showToast('Failed to copy text.');
      } finally {
        document.body.removeChild(textarea);
      }
    });
  }

  // Improved replace action with safety checks
  function safeReplaceSelectedText(newText) {
    try {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      const range = selection.getRangeAt(0);
      const parentElement = range.commonAncestorContainer.parentElement;

      if (parentElement.isContentEditable || parentElement.tagName === 'BODY') {
        showToast('Cannot replace text in rich editors. Copied instead.');
        copyToClipboard(newText);
        return;
      }

      range.deleteContents();
      range.insertNode(document.createTextNode(newText));
    } catch (error) {
      console.error('Replace failed:', error);
      showToast('Failed to replace text. Copied instead.');
      copyToClipboard(newText);
    }
  }

  // Updated addCopyAndReplaceActions function
  function addCopyAndReplaceActions() {
    const resultContainer = document.getElementById('summarize-result');

    // Create Copy button
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', () => {
      copyToClipboard(resultContainer.textContent);
    });

    // Create Replace button
    const replaceButton = document.createElement('button');
    replaceButton.textContent = 'Replace selected text';
    replaceButton.addEventListener('click', () => {
      safeReplaceSelectedText(resultContainer.textContent);
    });

    // Append buttons to the result container
    resultContainer.appendChild(copyButton);
    resultContainer.appendChild(replaceButton);
  }

  // Updated selection validation
  function isValidSelection(selection) {
    const parentElement = selection.anchorNode?.parentElement;
    return (
      parentElement &&
      !['INPUT', 'TEXTAREA'].includes(parentElement.tagName) &&
      !parentElement.isContentEditable
    );
  }

  // Improved intent detection for smarter behavior
  function detectIntent(selectedText) {
    if (selectedText.length < 10) {
      return 'ignore'; // Ignore very short selections
    }

    if (selectedText.endsWith('?')) {
      return 'question'; // Treat question-like text differently
    }

    if (selectedText.length > 500) {
      return 'long'; // Default to bullet summary for long text
    }

    return 'default';
  }

  // Updated handleSelection function with intent detection
  function handleSelection() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();

      if (selectedText && selectedText.length <= 3000 && isValidSelection(selection)) {
        const intent = detectIntent(selectedText);

        if (intent === 'ignore') {
          hideFloatingIcon();
          return;
        }

        currentSelection = selectedText;
        const range = selection.getRangeAt(0);
        showFloatingIcon(range);

        const isCode = isCodeSelection(selection);
        updateIconTooltip(isCode);

        if (intent === 'question') {
          floatingIcon.title = 'Answer question';
        } else if (intent === 'long') {
          floatingIcon.title = 'Summarize (bullet points)';
        }
      } else {
        hideFloatingIcon();
      }
    }, DEBOUNCE_DELAY);
  }

  // Send summarize request to backend
  async function sendToBackend(text, type) {
    try {
      const response = await fetch('http://localhost:3000/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text, type })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch summary');
      }

      const data = await response.json();
      return data.summary;
    } catch (error) {
      console.error('Error sending to backend:', error);
      return 'Error: Unable to summarize text.';
    }
  }

  // Handle summarize button click
  async function handleSummarizeClick() {
    if (isRequestInProgress) return;

    const textArea = document.getElementById('summarize-text');
    const selectedText = textArea.value.trim();
    const summaryType = document.querySelector('input[name="summary-type"]:checked').value;

    if (!selectedText) {
      showToast('Please enter text to summarize.');
      return;
    }

    isRequestInProgress = true;
    const btn = document.getElementById('summarize-btn');
    const spinner = btn.querySelector('.spinner');
    const btnText = btn.querySelector('.btn-text');
    const resultEl = document.getElementById('summarize-result');

    spinner.style.display = 'inline-block';
    btnText.textContent = 'Summarizing...';

    const summary = await sendToBackend(selectedText, summaryType);

    resultEl.textContent = summary;
    addCopyAndReplaceActions();

    spinner.style.display = 'none';
    btnText.textContent = 'Summarize';
    isRequestInProgress = false;
  }

  // Inject floating UI with two icons
  (function() {
    if (document.getElementById('ai-floating-ui')) {
      console.log('Floating UI already injected.');
      return;
    }

    console.log('Injecting floating UI.');

    const floatingUI = document.createElement('div');
    floatingUI.id = 'ai-floating-ui';
    floatingUI.style.position = 'fixed';
    floatingUI.style.bottom = '20px';
    floatingUI.style.right = '20px';
    floatingUI.style.zIndex = '10000';
    floatingUI.style.display = 'flex';
    floatingUI.style.gap = '10px';

    const icon1 = document.createElement('img');
    icon1.src = chrome.runtime.getURL('icons/custom-icon1.png');
    icon1.alt = 'Custom Icon 1';
    icon1.style.width = '50px';
    icon1.style.height = '50px';
    icon1.style.cursor = 'pointer';
    icon1.addEventListener('click', () => {
      console.log('Custom Icon 1 clicked.');
      alert('Custom Icon 1 action triggered.');
    });

    const icon2 = document.createElement('img');
    icon2.src = chrome.runtime.getURL('icons/custom-icon2.png');
    icon2.alt = 'Custom Icon 2';
    icon2.style.width = '50px';
    icon2.style.height = '50px';
    icon2.style.cursor = 'pointer';
    icon2.addEventListener('click', () => {
      console.log('Custom Icon 2 clicked.');
      alert('Custom Icon 2 action triggered.');
    });

    floatingUI.appendChild(icon1);
    floatingUI.appendChild(icon2);
    document.body.appendChild(floatingUI);

    console.log('Floating UI injected successfully.');
  })();

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getSelectedText') {
      console.log('Content script received getSelectedText message');

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        sendResponse({ error: 'No text selected.' });
        return;
      }

      sendResponse({ text: selection.toString() });
    }
  });

  // Attach event listeners
  function attachEventListeners() {
    const summarizeBtn = document.getElementById('summarize-btn');
    summarizeBtn.addEventListener('click', handleSummarizeClick);

    document.addEventListener('selectionchange', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          hideFloatingIcon();
          return;
        }

        const range = selection.getRangeAt(0);
        currentSelection = range.toString();
        const isCode = isCodeSelection(selection);
        updateIconTooltip(isCode);
        showFloatingIcon(range);
      }, DEBOUNCE_DELAY);
    });

    floatingIcon.addEventListener('click', showPopup);
  }

  // Initialize content script
  function initContentScript() {
    injectStyles();
    createUIElements();
    attachEventListeners();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContentScript);
  } else {
    initContentScript();
  }

  // Verify content script injection
  (function() {
    console.log('Content script loaded successfully.');

    // Ensure floating UI is injected
    if (document.getElementById('ai-floating-ui')) {
      console.log('Floating UI already exists.');
      return;
    }

    console.log('Injecting floating UI.');

    const floatingUI = document.createElement('div');
    floatingUI.id = 'ai-floating-ui';
    floatingUI.style.position = 'fixed';
    floatingUI.style.bottom = '20px';
    floatingUI.style.right = '20px';
    floatingUI.style.zIndex = '10000';
    floatingUI.style.display = 'flex';
    floatingUI.style.gap = '10px';

    const icon1 = document.createElement('img');
    icon1.src = chrome.runtime.getURL('icons/custom-icon1.png');
    icon1.alt = 'Custom Icon 1';
    icon1.style.width = '50px';
    icon1.style.height = '50px';
    icon1.style.cursor = 'pointer';
    icon1.addEventListener('click', () => {
      console.log('Custom Icon 1 clicked.');
      alert('Custom Icon 1 action triggered.');
    });

    const icon2 = document.createElement('img');
    icon2.src = chrome.runtime.getURL('icons/custom-icon2.png');
    icon2.alt = 'Custom Icon 2';
    icon2.style.width = '50px';
    icon2.style.height = '50px';
    icon2.style.cursor = 'pointer';
    icon2.addEventListener('click', () => {
      console.log('Custom Icon 2 clicked.');
      alert('Custom Icon 2 action triggered.');
    });

    floatingUI.appendChild(icon1);
    floatingUI.appendChild(icon2);
    document.body.appendChild(floatingUI);

    console.log('Floating UI injected successfully.');
  })();
})();
