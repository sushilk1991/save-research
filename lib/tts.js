// ============================================================
// Save Research — Text-to-Speech Module
// ============================================================
// Provides text-to-speech capabilities using the Web Speech API.
// No Chrome API dependencies.

const TTS = (() => {
  let utterance = null;
  let isSpeaking = false;
  let isPaused = false;
  let onStateChange = null; // Callback: (state: 'playing'|'paused'|'stopped') => void

  /**
   * Check if TTS is available in this browser.
   * @returns {boolean}
   */
  function isAvailable() {
    return typeof speechSynthesis !== 'undefined';
  }

  /**
   * Get available voices, preferring English ones.
   * @returns {SpeechSynthesisVoice[]}
   */
  function getVoices() {
    if (!isAvailable()) return [];
    return speechSynthesis.getVoices();
  }

  /**
   * Get a good default voice (prefers natural-sounding English).
   * @returns {SpeechSynthesisVoice|null}
   */
  function getDefaultVoice() {
    const voices = getVoices();
    // Prefer enhanced/premium voices
    const premium = voices.find(v =>
      v.lang.startsWith('en') && (v.name.includes('Enhanced') || v.name.includes('Premium') || v.name.includes('Natural'))
    );
    if (premium) return premium;

    // Fall back to any English voice
    const english = voices.find(v => v.lang.startsWith('en'));
    if (english) return english;

    // Fall back to default
    return voices[0] || null;
  }

  /**
   * Speak the given text.
   * @param {string} text - Text to speak
   * @param {object} [options] - TTS options
   * @param {number} [options.rate=1] - Speech rate (0.5 to 2)
   * @param {number} [options.pitch=1] - Speech pitch (0 to 2)
   * @param {SpeechSynthesisVoice} [options.voice] - Voice to use
   */
  function speak(text, options = {}) {
    if (!isAvailable() || !text) return;

    // Stop any current speech
    stop();

    // Clean text for speech (strip markdown, code blocks, etc.)
    const cleanedText = cleanTextForSpeech(text);

    utterance = new SpeechSynthesisUtterance(cleanedText);
    utterance.rate = options.rate || 1;
    utterance.pitch = options.pitch || 1;
    utterance.voice = options.voice || getDefaultVoice();

    utterance.onstart = () => {
      isSpeaking = true;
      isPaused = false;
      if (onStateChange) onStateChange('playing');
    };

    utterance.onend = () => {
      isSpeaking = false;
      isPaused = false;
      utterance = null;
      if (onStateChange) onStateChange('stopped');
    };

    utterance.onerror = () => {
      isSpeaking = false;
      isPaused = false;
      utterance = null;
      if (onStateChange) onStateChange('stopped');
    };

    speechSynthesis.speak(utterance);
  }

  /**
   * Pause current speech.
   */
  function pause() {
    if (isAvailable() && isSpeaking && !isPaused) {
      speechSynthesis.pause();
      isPaused = true;
      if (onStateChange) onStateChange('paused');
    }
  }

  /**
   * Resume paused speech.
   */
  function resume() {
    if (isAvailable() && isPaused) {
      speechSynthesis.resume();
      isPaused = false;
      if (onStateChange) onStateChange('playing');
    }
  }

  /**
   * Stop speech entirely.
   */
  function stop() {
    if (isAvailable()) {
      speechSynthesis.cancel();
      isSpeaking = false;
      isPaused = false;
      utterance = null;
      if (onStateChange) onStateChange('stopped');
    }
  }

  /**
   * Toggle play/pause.
   * @param {string} [text] - Text to speak if not currently speaking
   */
  function toggle(text) {
    if (isSpeaking && !isPaused) {
      pause();
    } else if (isPaused) {
      resume();
    } else if (text) {
      speak(text);
    }
  }

  /**
   * Get current state.
   * @returns {'playing'|'paused'|'stopped'}
   */
  function getState() {
    if (isSpeaking && !isPaused) return 'playing';
    if (isPaused) return 'paused';
    return 'stopped';
  }

  /**
   * Set state change callback.
   * @param {function} callback
   */
  function setOnStateChange(callback) {
    onStateChange = callback;
  }

  /**
   * Clean text for speech synthesis — strip markdown formatting.
   * @param {string} text
   * @returns {string}
   */
  function cleanTextForSpeech(text) {
    return text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, ' code block omitted ')
      // Remove inline code
      .replace(/`[^`]+`/g, (match) => match.slice(1, -1))
      // Remove markdown links, keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove heading markers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic markers
      .replace(/\*{1,3}(.+?)\*{1,3}/g, '$1')
      .replace(/_{1,3}(.+?)_{1,3}/g, '$1')
      // Remove blockquote markers
      .replace(/^>\s+/gm, '')
      // Remove list markers
      .replace(/^[*\-+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, '')
      // Clean up extra whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return {
    isAvailable,
    getVoices,
    getDefaultVoice,
    speak,
    pause,
    resume,
    stop,
    toggle,
    getState,
    setOnStateChange,
    cleanTextForSpeech,
  };
})();

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cleanTextForSpeech: TTS.cleanTextForSpeech };
}
