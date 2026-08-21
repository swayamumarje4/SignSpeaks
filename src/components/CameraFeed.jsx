import { useRef, useEffect, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import classifyLetter from '../classifyLetter';

// Abort controller pattern: each init increments a counter;
// stale inits detect they are obsolete and bail out.

// MediaPipe standard hand skeleton connections
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [0, 9], [9, 10], [10, 11], [11, 12],  // middle
  [0, 13], [13, 14], [14, 15], [15, 16],// ring
  [0, 17], [17, 18], [18, 19], [19, 20],// pinky
  [5, 9], [9, 13], [13, 17],            // palm
];

export default function CameraFeed({ onHandLandmarks, onLetterDetected }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const animFrameRef = useRef(null);
  const initCountRef = useRef(0);
  const [cameraError, setCameraError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Starting camera...');
  const [retryCount, setRetryCount] = useState(0);

  // Mirror a landmark x-coordinate: mirrored_x = 1 - x
  const mirrorX = (x) => 1 - x;

  const drawLandmarks = useCallback((canvas, landmarks) => {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    ctx.clearRect(0, 0, width, height);

    if (!landmarks || landmarks.length === 0) return;

    for (const hand of landmarks) {
      // Draw skeleton connections
      ctx.strokeStyle = 'rgba(0, 255, 170, 0.6)';
      ctx.lineWidth = 2;

      for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
        const start = hand[startIdx];
        const end = hand[endIdx];
        if (!start || !end) continue;

        const startX = mirrorX(start.x) * width;
        const startY = start.y * height;
        const endX = mirrorX(end.x) * width;
        const endY = end.y * height;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      // Draw landmark dots
      for (let i = 0; i < hand.length; i++) {
        const lm = hand[i];
        const x = mirrorX(lm.x) * width;
        const y = lm.y * height;

        // Outer glow
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(0, 255, 170, 0.3)';
        ctx.fill();

        // Inner dot
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = i === 0 ? '#ff4488' : '#00ffaa';
        ctx.fill();
      }
    }
  }, []);

  // Use refs for callbacks so the detect loop and effect don't re-create
  // every render (which would kill the camera stream).
  const onHandLandmarksRef = useRef(onHandLandmarks);
  onHandLandmarksRef.current = onHandLandmarks;
  const onLetterDetectedRef = useRef(onLetterDetected);
  onLetterDetectedRef.current = onLetterDetected;

  // Detection loop — depends only on drawLandmarks (stable) via refs for callbacks.
  const detect = useCallback((video, canvas, handLandmarker) => {
    if (!video || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(() =>
        detect(video, canvas, handLandmarker)
      );
      return;
    }

    // Sync canvas to actual video resolution
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const results = handLandmarker.detectForVideo(video, performance.now());

    if (results.landmarks && results.landmarks.length > 0) {
      drawLandmarks(canvas, results.landmarks);
      if (onHandLandmarksRef.current) onHandLandmarksRef.current(results.landmarks);
      const letter = classifyLetter(results.landmarks[0]);
      if (onLetterDetectedRef.current) onLetterDetectedRef.current(letter);
    } else {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (onHandLandmarksRef.current) onHandLandmarksRef.current(null);
      if (onLetterDetectedRef.current) onLetterDetectedRef.current(null);
    }

    animFrameRef.current = requestAnimationFrame(() =>
      detect(video, canvas, handLandmarker)
    );
  }, [drawLandmarks]);

  useEffect(() => {
    let stream = null;
    let initId = ++initCountRef.current; // unique ID for this mount
    let cancelled = false;

    const init = async () => {
      try {
        setLoadingMessage('Starting camera...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });

        // A newer init has started — bail out silently
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Suppress interrupted-play error from StrictMode unmount/remount
          videoRef.current.play().catch(() => {});
        }

        setLoadingMessage('Loading hand detection model...');
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });

        if (cancelled) {
          handLandmarker.close();
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        handLandmarkerRef.current = handLandmarker;
        setIsLoading(false);
        detect(videoRef.current, canvasRef.current, handLandmarker);
      } catch (err) {
        if (cancelled) return;
        console.error('Init error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError('Camera access needed — please allow permission and refresh.');
        } else if (
          err.name === 'NotReadableError' ||
          (err.message && err.message.toLowerCase().includes('device in use'))
        ) {
          setCameraError(
            'Camera is in use by another app.\nClose other apps using the camera (Zoom, Teams, VS Code preview, etc.) and refresh.'
          );
        } else {
          setCameraError(`Camera error: ${err.message}`);
        }
        setIsLoading(false);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [detect, retryCount]);

  const handleRetry = useCallback(() => {
    setCameraError(null);
    setIsLoading(true);
    setLoadingMessage('Starting camera...');
    setRetryCount((c) => c + 1);
  }, []);

  if (cameraError) {
    return (
      <div className="camera-error">
        <div className="error-icon">📷</div>
        <p style={{ whiteSpace: 'pre-line' }}>{cameraError}</p>
        <button className="btn btn-retry" onClick={handleRetry}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="camera-container">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="camera-video"
      />
      <canvas ref={canvasRef} className="camera-canvas" />
      {isLoading && (
        <div className="camera-loading">
          <div className="spinner" />
          <p>{loadingMessage}</p>
        </div>
      )}
    </div>
  );
}
