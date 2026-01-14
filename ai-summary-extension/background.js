// Background service worker for AI summarization and code explanation
// Handles API calls securely, away from content scripts

// Configuration
const API_ENDPOINT = 'https://api.example.com/summarize'; // Placeholder - replace with real endpoint
const API_KEY = 'placeholder_key'; // Placeholder - replace with real key
const MAX_TEXT_LENGTH = 3000;
const MAX_RETRIES = 1;
const REQUEST_TIMEOUT = 15000; // 15 seconds timeout

// Updated sanitizeText function
function sanitizeText(text) {
  if (typeof text !== 'string') {
    return '';
  }
  return text.trim().substring(0, MAX_TEXT_LENGTH).replace(/[<>"'&]/g, ''); // Basic sanitization
}

// Check if request is in progress (prevent multiple simultaneous requests)
let isRequestInProgress = false;

// Detect if text is likely code
function isCodeSnippet(text) {
  // Simple heuristics for code detection
  const codeIndicators = [
    /\b(function|class|if|for|while|return|import|export|const|let|var)\b/,
    /[{}();]/,
    /\b(true|false|null|undefined)\b/,
    /\b(console\.|document\.|window\.)\b/
  ];
  return codeIndicators.some(regex => regex.test(text));
}

// Improved AI prompt generation for better output quality
function generatePrompt(text, type, isCode) {
  if (isCode) {
    return `You are a senior software engineer.\n\nPurpose: Explain what this code does in simple terms.\n\nHow it works: Provide a clear, step-by-step explanation.\n\nKey points: Highlight the most important aspects of the code.\n\nDo NOT rewrite the code.\n\nCode:\n${text}`;
  } else {
    const typeMap = {
      short: 'You are a professional writing assistant.\n\nSummary:\nProvide a concise summary (1-2 sentences) with a clear heading.',
      medium: 'You are a professional writing assistant.\n\nSummary:\nProvide a detailed summary (3-5 sentences) with a clear heading.',
      bullet: 'You are a professional writing assistant.\n\nSummary:\nProvide a bullet-point summary with key points and a clear heading.'
    };
    return `${typeMap[type] || typeMap.medium}\n\nText:\n${text}`;
  }
}

// API call with retry logic, timeout, and network error handling
async function callAPI(prompt, retryCount = 0) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        prompt: prompt,
        max_tokens: 500
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status >= 500 && retryCount < MAX_RETRIES) {
        // Retry on server errors
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
        return callAPI(prompt, retryCount + 1);
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.response || data.summary || 'Response not available.';
  } catch (error) {
    clearTimeout(timeoutId);

    if (retryCount < MAX_RETRIES) {
      if (error.name === 'AbortError' || error instanceof TypeError) {
        // Retry on timeout or network errors
        console.warn(`Retrying due to error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
        return callAPI(prompt, retryCount + 1);
      }
    }

    throw error; // Do not retry on other errors
  }
}

// Validate incoming message
function validateRequest(request) {
  if (typeof request.text !== 'string' || !['short', 'medium', 'bullet'].includes(request.type)) {
    return false;
  }
  return true;
}

// Subscription check logic
async function checkSubscription(email) {
  const cachedSubscription = await chrome.storage.local.get('subscription');
  if (cachedSubscription && cachedSubscription.email === email) {
    return cachedSubscription;
  }

  try {
    const response = await fetch(`https://your-backend-url/check-subscription?email=${email}`);
    if (!response.ok) {
      throw new Error('Failed to fetch subscription status');
    }
    const subscription = await response.json();
    await chrome.storage.local.set({ subscription });
    return subscription;
  } catch (error) {
    console.error('Subscription check failed:', error);
    return { plan: 'free' };
  }
}

// Enforce Free vs Pro limits
function enforceLimits(subscription) {
  if (subscription.plan === 'free') {
    return {
      maxSummaries: 5,
      allowedTypes: ['short'],
      allowCodeExplanation: false,
    };
  }
  return {
    maxSummaries: Infinity,
    allowedTypes: ['short', 'medium', 'bullet'],
    allowCodeExplanation: true,
  };
}

// Collect user email during upgrade
async function collectUserEmail() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'promptEmail' }, (response) => {
      if (response && response.email) {
        resolve(response.email);
      } else {
        resolve(null);
      }
    });
  });
}

// Handle messages from content script
chrome.runtime.onMessage.addListener(async function(request, sender, sendResponse) {
  if (request.action === 'summarizeText') {
    if (isRequestInProgress) {
      sendResponse({ error: 'Request already in progress. Please wait.' });
      return;
    }

    if (!validateRequest(request)) {
      sendResponse({ error: 'Invalid request format.' });
      return;
    }

    const email = request.email; // Assume email is passed in the request
    const subscription = await checkSubscription(email);
    const limits = enforceLimits(subscription);

    if (limits.maxSummaries <= 0) {
      sendResponse({ error: 'Daily limit reached. Upgrade to Pro for unlimited access.' });
      return;
    }

    if (!limits.allowedTypes.includes(request.type)) {
      sendResponse({ error: 'This summary type is not available in the free plan.' });
      return;
    }

    if (request.isCode && !limits.allowCodeExplanation) {
      sendResponse({ error: 'Code explanation is a Pro feature. Upgrade to Pro to access this feature.' });
      return;
    }

    const { text, type, isCode: contentScriptIsCode } = request;
    const sanitizedText = sanitizeText(text);

    if (!sanitizedText) {
      sendResponse({ error: 'No valid text provided.' });
      return;
    }

    isRequestInProgress = true;

    // Final code detection
    const isCode = contentScriptIsCode || isCodeSnippet(sanitizedText);

    // Generate appropriate prompt
    const prompt = generatePrompt(sanitizedText, type, isCode);

    // Perform API call with retries
    callAPI(prompt)
      .then(result => {
        sendResponse({ summary: result, isCode: isCode });
      })
      .catch(error => {
        console.error('Summarization error:', error);
        sendResponse({ error: 'Unable to process. Please check your connection or API configuration.' });
      })
      .finally(() => {
        isRequestInProgress = false;
      });

    return true; // Keep message channel open for async response
  }

  if (request.action === 'getPreferences') {
    chrome.storage.sync.get(['preferredSummaryType'], function(result) {
      sendResponse({ preferredType: result.preferredSummaryType || 'short' });
    });
    return true;
  }

  if (request.action === 'savePreferences') {
    chrome.storage.sync.set({ preferredSummaryType: request.type });
    sendResponse({ success: true });
  }

  if (request.action === 'upgradeToPro') {
    const email = await collectUserEmail();
    if (!email) {
      sendResponse({ error: 'Email is required to upgrade to Pro.' });
      return;
    }

    // Redirect to Stripe Checkout
    const checkoutUrl = `https://your-stripe-checkout-url?email=${encodeURIComponent(email)}`;
    chrome.tabs.create({ url: checkoutUrl });
    sendResponse({ success: true });
  }
});
