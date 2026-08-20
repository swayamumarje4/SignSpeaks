import { useRef, useEffect, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import classifyLetter from '../classifyLetter';

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
  const [cameraError, setCameraError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Starting camera...');

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

  // Detection loop
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
      if (onHandLandmarks) onHandLandmarks(results.landmarks);
      const letter = classifyLetter(results.landmarks[0]);
      if (onLetterDetected) onLetterDetected(letter);
    } else {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (onHandLandmarks) onHandLandmarks(null);
      if (onLetterDetected) onLetterDetected(null);
    }

    animFrameRef.current = requestAnimationFrame(() =>
      detect(video, canvas, handLandmarker)
    );
  }, [drawLandmarks, onHandLandmarks, onLetterDetected]);

  useEffect(() => {
    let stream = null;

    const init = async () => {
      try {
        setLoadingMessage('Starting camera...');
        // Request webcam access
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setLoadingMessage('Loading hand detection model...');
        // Load MediaPipe
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });

        handLandmarkerRef.current = handLandmarker;
        setIsLoading(false);

        // Start detection loop
        detect(videoRef.current, canvasRef.current, handLandmarker);
      } catch (err) {
        console.error('Init error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError('Camera access needed — please allow permission and refresh.');
        } else {
          setCameraError(`Error: ${err.message}`);
        }
        setIsLoading(false);
      }
    };

    init();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (handLandmarkerRef.current) handLandmarkerRef.current.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [detect]);

  if (cameraError) {
    return (
      <div className="camera-error">
        <div className="error-icon">📷</div>
        <p>{cameraError}</p>
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
