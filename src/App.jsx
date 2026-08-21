import { useState, useCallback, useRef, useMemo } from 'react';
import CameraFeed from './components/CameraFeed';
import useStabilizer from './useStabilizer';
import { getSuggestions } from './dictionary';
import './App.css';

const MAX_BUFFER_LENGTH = 20;
const SUPPORTED_LETTERS = ['A', 'B', 'C', 'L', 'O', 'Y', 'I'];

function App() {
  const [handDetected, setHandDetected] = useState(false);
  const [currentLetter, setCurrentLetter] = useState(null);
  const [currentWord, setCurrentWord] = useState('');
  const [sentence, setSentence] = useState('');
  const [lastConfirmed, setLastConfirmed] = useState(null);
  const [confirmFlash, setConfirmFlash] = useState(false);
  const flashTimerRef = useRef(null);

  // ── Suggestions (derived, recomputed every render) ──
  const suggestions = useMemo(
    () => getSuggestions(currentWord),
    [currentWord]
  );

  const handleConfirm = useCallback((letter) => {
    setCurrentWord((prev) => {
      if (prev.length >= MAX_BUFFER_LENGTH) return prev;
      return prev + letter;
    });
    setLastConfirmed(letter);
    setConfirmFlash(true);

    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setConfirmFlash(false), 400);
  }, []);

  const stabilizer = useStabilizer({
    windowSize: 20,
    confirmThreshold: 15,
    onConfirm: handleConfirm,
  });

  const handleHandLandmarks = useCallback((landmarks) => {
    setHandDetected(!!landmarks && landmarks.length > 0);
  }, []);

  const handleLetterDetected = useCallback((letter) => {
    setCurrentLetter(letter);
    stabilizer.feed(letter);
  }, [stabilizer]);

  // ── UI actions ──

  const handleSpace = useCallback(() => {
    setCurrentWord((prev) => {
      if (prev.length === 0) return prev;
      setSentence((s) => {
        const newSentence = s ? s + ' ' + prev : prev;
        return newSentence;
      });
      return '';
    });
  }, []);

  const handleBackspace = useCallback(() => {
    setCurrentWord((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setCurrentWord('');
    setSentence('');
    setLastConfirmed(null);
    stabilizer.reset();
  }, [stabilizer]);

  const handleSuggestionClick = useCallback((word) => {
    setSentence((s) => {
      const newSentence = s ? s + ' ' + word : word;
      return newSentence;
    });
    setCurrentWord('');
  }, []);

  const handleSpeak = useCallback(() => {
    if (!sentence.trim()) return;
    if (!window.speechSynthesis) return;

    // Cancel any in-progress speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }, [sentence]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">
            <span className="title-icon">🤟</span>
            SignSpeak
          </h1>
          <p className="app-subtitle">Real-Time Hand Sign to Text Converter</p>
        </div>
        <div className="supported-letters">
          <span className="supported-label">Supported</span>
          <span className="supported-chars">
            {SUPPORTED_LETTERS.map((l) => (
              <span key={l} className="supported-char">{l}</span>
            ))}
          </span>
        </div>
      </header>

      <main className="app-main">
        <div className="camera-section">
          <CameraFeed
            onHandLandmarks={(lm) => setHandDetected(!!lm && lm.length > 0)}
            onLetterDetected={handleLetterDetected}
          />
          <div className={`status-badge ${handDetected ? 'active' : ''}`}>
            <span className="status-dot" />
            {handDetected ? 'Hand Detected' : 'No Hand Detected'}
          </div>
        </div>

        <div className="output-section">
          {/* Current letter indicator */}
          <div className="letter-display">
            <p className="letter-label">Detected Letter</p>
            <div className={`letter-current ${currentLetter ? 'active' : ''} ${confirmFlash ? 'flash' : ''}`}>
              {currentLetter || '—'}
            </div>
            <p className="letter-hint">
              {currentLetter
                ? 'Hold ~1s to confirm...'
                : 'Show a hand sign (A, B, C, L, O, Y, I)'}
            </p>
          </div>

          {/* Text output */}
          <div className="text-output">
            <div className="sentence-area">
              <p className="sentence-label">Sentence</p>
              <div className="sentence-text">{sentence || '\u00A0'}</div>
            </div>

            <div className="word-area">
              <p className="word-label">Current Word</p>
              <div className={`word-text ${currentWord ? 'active' : ''}`}>
                {currentWord || '\u00A0'}
                <span className="cursor">|</span>
              </div>
            </div>

            {/* Suggestion chips */}
            {suggestions.length > 0 && (
              <div className="suggestions">
                {suggestions.map((word) => (
                  <button
                    key={word}
                    className="suggestion-chip"
                    onClick={() => handleSuggestionClick(word)}
                  >
                    {word}
                  </button>
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="controls">
              <button className="btn btn-space" onClick={handleSpace}>
                <span className="btn-icon">␣</span>
                Space
              </button>
              <button className="btn btn-back" onClick={handleBackspace}>
                <span className="btn-icon">⌫</span>
                Back
              </button>
              <button className="btn btn-clear" onClick={handleClear}>
                <span className="btn-icon">✕</span>
                Clear
              </button>
            </div>

            {/* TTS Speak */}
            <button
              className="btn btn-speak"
              onClick={handleSpeak}
              disabled={!sentence.trim()}
            >
              <span className="btn-icon">🔊</span>
              Speak
            </button>
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <p>SignSpeak — Runs fully client-side, no data leaves your browser.</p>
      </footer>
    </div>
  );
}

export default App;
