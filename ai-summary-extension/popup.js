// popup.js
// Handles communication between the popup and the content script

document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup loaded');

  const summarizeButton = document.getElementById('summarize-btn');

  summarizeButton.addEventListener('click', () => {
    console.log('Summarize button clicked');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];

      chrome.tabs.sendMessage(activeTab.id, { action: 'getSelectedText' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error communicating with content script:', chrome.runtime.lastError);
          document.getElementById('result').textContent = 'Error: Unable to communicate with the content script.';
          return;
        }

        const resultElement = document.getElementById('result');
        if (response.error) {
          resultElement.textContent = `Error: ${response.error}`;
        } else {
          resultElement.textContent = response.text || 'No text selected.';
        }
      });
    });
  });
});