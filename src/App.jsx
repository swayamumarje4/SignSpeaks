import { useState, useCallback } from 'react';
import CameraFeed from './components/CameraFeed';
import './App.css';

function App() {
  const [handDetected, setHandDetected] = useState(false);

  const handleHandLandmarks = useCallback((landmarks) => {
    setHandDetected(!!landmarks && landmarks.length > 0);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="title-icon">🤟</span>
          SignSpeak
        </h1>
        <p className="app-subtitle">Real-Time Hand Sign to Text Converter</p>
      </header>

      <main className="app-main">
        <div className="camera-section">
          <CameraFeed onHandLandmarks={handleHandLandmarks} />
          <div className={`status-badge ${handDetected ? 'active' : ''}`}>
            <span className="status-dot" />
            {handDetected ? 'Hand Detected' : 'No Hand Detected'}
          </div>
        </div>

        <div className="output-section">
          <div className="output-placeholder">
            <p>Letter detection and text output will appear here in Phase 2.</p>
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <p>SignSpeak — Built for hackathon. Runs fully client-side, no data leaves your browser.</p>
      </footer>
    </div>
  );
}

export default App;
