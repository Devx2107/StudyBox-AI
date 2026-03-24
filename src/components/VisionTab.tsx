import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { ModelCategory, VideoCapture } from '@runanywhere/web';
import { VLMWorkerBridge } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import type { HistoryReporter } from '../types/history';
import { analyzeClaudeImage, type ClaudeSettings } from '../lib/anthropic';

const LIVE_INTERVAL_MS = 2500;
const LIVE_MAX_TOKENS = 20;
const SINGLE_MAX_TOKENS = 56;
const CAPTURE_DIM = 256;

interface VisionResult {
  text: string;
  totalMs: number;
  meta?: string;
}

interface UploadedImage {
  file: File;
  previewUrl: string;
}

interface VisionTabProps extends HistoryReporter {
  providerMode: 'local' | 'hybrid' | 'claude';
  claude: ClaudeSettings;
}

function rgbFromImageData(data: Uint8ClampedArray) {
  const rgb = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return rgb;
}

async function extractImagePixels(file: File, targetMaxDim: number) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode the selected image.'));
      img.src = objectUrl;
    });

    const scale = Math.min(1, targetMaxDim / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not open a canvas for image analysis.');

    ctx.drawImage(image, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { width, height, rgbPixels: rgbFromImageData(imageData.data) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function captureCameraFile(capture: VideoCapture, targetMaxDim: number) {
  const video = capture.videoElement;
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const scale = Math.min(1, targetMaxDim / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not capture the current camera frame.');

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('Could not export the camera frame.'));
    }, 'image/jpeg', 0.92);
  });

  return new File([blob], 'camera-frame.jpg', { type: 'image/jpeg' });
}

export function VisionTab({ onHistoryEntry, providerMode, claude }: VisionTabProps) {
  const loader = useModelLoader(ModelCategory.Multimodal);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [prompt, setPrompt] = useState(
    'You are a helpful study assistant. Analyze the image. If it contains a question or problem, solve it step-by-step in a clear and simple way. If it is notes, summarize them in bullet points.',
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoMountRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<VideoCapture | null>(null);
  const processingRef = useRef(false);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveModeRef = useRef(false);

  processingRef.current = processing;
  liveModeRef.current = liveMode;

  const stopLive = useCallback(() => {
    setLiveMode(false);
    liveModeRef.current = false;
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current);
      liveIntervalRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    const cam = captureRef.current;
    if (!cam) return;
    cam.stop();
    cam.videoElement.parentNode?.removeChild(cam.videoElement);
    captureRef.current = null;
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (captureRef.current?.isCapturing) return;

    setError(null);
    setUploadedImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });

    try {
      const cam = new VideoCapture({ facingMode: 'environment' });
      await cam.start();
      captureRef.current = cam;
      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        setError('Camera permission denied. Check your browser camera permissions and try again.');
      } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
        setError('No camera found on this device.');
      } else if (msg.includes('NotReadable') || msg.includes('TrackStartError')) {
        setError('Camera is in use by another application.');
      } else {
        setError(`Camera error: ${msg}`);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    return () => {
      if (uploadedImage) {
        URL.revokeObjectURL(uploadedImage.previewUrl);
      }
    };
  }, [uploadedImage]);

  useEffect(() => {
    const mount = videoMountRef.current;
    const capture = captureRef.current;

    if (!mount || !capture?.isCapturing) {
      return;
    }

    const el = capture.videoElement;
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.objectFit = 'cover';

    if (el.parentNode !== mount) {
      mount.replaceChildren(el);
    }
  }, [cameraActive, processing, liveMode, result, error]);

  const runLocalVision = useCallback(async (
    rgbPixels: Uint8Array,
    width: number,
    height: number,
    maxTokens: number,
  ) => {
    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) {
        throw new Error(loader.error || 'Could not load the local VLM.');
      }
    }

    const bridge = VLMWorkerBridge.shared;
    if (!bridge.isModelLoaded) {
      throw new Error('Local VLM loaded, but the worker is not ready yet. Try once more.');
    }

    const response = await bridge.process(
      rgbPixels,
      width,
      height,
      `You are a helpful study assistant.
      Analyze this image carefully.

      If it contains:
      - A math problem: solve step-by-step
      - Theory: explain clearly
      - Notes: summarize in bullets

      User request: ${prompt}`,
      { maxTokens, temperature: 0.35 },
    );

    return {
      text: response.text,
      meta: 'Local VLM',
    };
  }, [loader, prompt]);

  const runClaudeVision = useCallback(async (file: File) => {
    const response = await analyzeClaudeImage(prompt, file, claude, {
      maxTokens: 900,
      temperature: 0.25,
      systemPrompt: 'You are a precise study assistant. Read the image carefully, solve problems accurately, and explain your reasoning clearly.',
    });

    return {
      text: response.text || 'Claude returned an empty vision response.',
      meta: response.usage
        ? `Claude - ${response.usage.input_tokens ?? 0} in / ${response.usage.output_tokens ?? 0} out`
        : 'Claude',
    };
  }, [claude, prompt]);

  const processUploadedImage = useCallback(async (file: File, maxTokens: number) => {
    const preferClaude = providerMode === 'claude';
    const canUseClaude = Boolean(claude.apiKey.trim());

    if (preferClaude) {
      return runClaudeVision(file);
    }

    try {
      const { rgbPixels, width, height } = await extractImagePixels(file, CAPTURE_DIM);
      return await runLocalVision(rgbPixels, width, height, maxTokens);
    } catch (err) {
      if (providerMode === 'hybrid' && canUseClaude) {
        return runClaudeVision(file);
      }
      throw err;
    }
  }, [providerMode, claude.apiKey, runClaudeVision, runLocalVision]);

  const processCameraFrame = useCallback(async (maxTokens: number) => {
    const capture = captureRef.current;
    if (!capture?.isCapturing) {
      throw new Error('Start the camera or upload an image first.');
    }

    const preferClaude = providerMode === 'claude';
    const canUseClaude = Boolean(claude.apiKey.trim());

    if (preferClaude) {
      const file = await captureCameraFile(capture, 960);
      return runClaudeVision(file);
    }

    try {
      const frame = capture.captureFrame(CAPTURE_DIM);
      if (!frame) throw new Error('Could not capture a frame from the camera.');
      return await runLocalVision(frame.rgbPixels, frame.width, frame.height, maxTokens);
    } catch (err) {
      if (providerMode === 'hybrid' && canUseClaude) {
        const file = await captureCameraFile(capture, 960);
        return runClaudeVision(file);
      }
      throw err;
    }
  }, [providerMode, claude.apiKey, runClaudeVision, runLocalVision]);

  const runAnalysis = useCallback(async (maxTokens: number) => {
    if (processingRef.current) return;

    setProcessing(true);
    processingRef.current = true;
    setError(null);
    const startedAt = performance.now();

    try {
      const response = uploadedImage
        ? await processUploadedImage(uploadedImage.file, maxTokens)
        : await processCameraFrame(maxTokens);

      setResult({
        text: response.text,
        totalMs: performance.now() - startedAt,
        meta: response.meta,
      });

      if (!liveModeRef.current) {
        onHistoryEntry?.({ source: 'vision', prompt, response: response.text });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isWasmCrash = msg.includes('memory access out of bounds') || msg.includes('RuntimeError');

      if (isWasmCrash) {
        setResult({ text: 'Recovering from memory error... next frame will retry.', totalMs: 0 });
      } else {
        setError(msg);
        if (!liveModeRef.current) {
          onHistoryEntry?.({ source: 'vision', prompt, response: `Error: ${msg}` });
        }
        if (liveModeRef.current) stopLive();
      }
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  }, [onHistoryEntry, processCameraFrame, processUploadedImage, prompt, stopLive, uploadedImage]);

  const describeSingle = useCallback(async () => {
    if (!captureRef.current?.isCapturing && !uploadedImage) {
      await startCamera();
      return;
    }
    await runAnalysis(SINGLE_MAX_TOKENS);
  }, [startCamera, runAnalysis, uploadedImage]);

  const startLive = useCallback(async () => {
    if (uploadedImage) {
      setError('Live mode works with the camera feed only. Clear the uploaded image first.');
      return;
    }

    if (!captureRef.current?.isCapturing) {
      await startCamera();
    }

    setLiveMode(true);
    liveModeRef.current = true;

    void runAnalysis(LIVE_MAX_TOKENS);

    liveIntervalRef.current = setInterval(() => {
      if (!processingRef.current && liveModeRef.current) {
        void runAnalysis(LIVE_MAX_TOKENS);
      }
    }, LIVE_INTERVAL_MS);
  }, [startCamera, runAnalysis, uploadedImage]);

  const toggleLive = useCallback(() => {
    if (liveMode) {
      stopLive();
    } else {
      void startLive();
    }
  }, [liveMode, startLive, stopLive]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    stopLive();
    stopCamera();
    setError(null);
    setResult(null);

    setUploadedImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return {
        file,
        previewUrl: URL.createObjectURL(file),
      };
    });

    event.target.value = '';
  };

  const clearUploadedImage = () => {
    setUploadedImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  };

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Vision scanner</div>
        <div className="card-badge">{liveMode ? 'live mode' : uploadedImage ? 'uploaded image' : 'single frame'}</div>
      </div>

      {providerMode !== 'claude' && (
        <ModelBanner
          state={loader.state}
          progress={loader.progress}
          error={loader.error}
          onLoad={loader.ensure}
          label="VLM"
        />
      )}

      <div className="card-body">
        <div className="camera-frame">
          <div className="camera-grid" />
          <div className="camera-corners" aria-hidden="true">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />
          </div>
          {cameraActive && <div className="camera-scan" />}
          <div className="camera-feed" ref={videoMountRef} />
          {!cameraActive && uploadedImage && (
            <div className="camera-overlay">
              <img className="vision-preview-image" src={uploadedImage.previewUrl} alt="Uploaded study material" />
            </div>
          )}
          {!cameraActive && !uploadedImage && (
            <div className="camera-overlay">
              <div className="empty-state camera-empty">
                <h3>Camera or image</h3>
                <p>Start the camera or upload a worksheet, notes page, or problem screenshot.</p>
              </div>
            </div>
          )}
          <div className="camera-label">
            {cameraActive ? <span className="rec-dot" /> : null}
            {cameraActive ? 'camera online' : uploadedImage ? 'image loaded' : 'camera offline'}
          </div>
        </div>

        <input
          className="vision-prompt"
          type="text"
          placeholder="What do you want to know about the image?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={liveMode}
        />

        <div className="vision-actions">
          <button className="btn" onClick={() => fileInputRef.current?.click()} type="button" disabled={liveMode}>
            Upload Image
          </button>
          {uploadedImage && (
            <button className="btn" onClick={clearUploadedImage} type="button" disabled={processing}>
              Clear Image
            </button>
          )}
          {!cameraActive ? (
            <button className="btn primary" onClick={startCamera} type="button" disabled={liveMode}>
              Start Camera
            </button>
          ) : (
            <button className="btn" onClick={stopCamera} type="button" disabled={processing || liveMode}>
              Stop Camera
            </button>
          )}
          <button
            className="btn primary"
            onClick={describeSingle}
            disabled={processing || liveMode || (!cameraActive && !uploadedImage)}
            type="button"
          >
            {processing && !liveMode ? 'Analyzing...' : cameraActive ? 'Click Picture' : 'Analyze Image'}
          </button>
          <button
            className={`btn ${liveMode ? 'pink' : ''}`}
            onClick={toggleLive}
            disabled={Boolean(uploadedImage) || (processing && !liveMode)}
            type="button"
          >
            {liveMode ? 'Stop Live' : 'Live'}
          </button>
        </div>

        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
        />

        <p className="study-hint">
          Local mode uses the offline VLM. Claude mode uses your API key for stronger image reasoning. Live mode is camera-only.
        </p>

        {error && (
          <div className="result-panel">
            <div className="result-panel-header">Vision error</div>
            <div className="result-panel-body">
              <span className="error-text">Error: {error}</span>
            </div>
          </div>
        )}

        {result && (
          <div className="result-panel">
            <div className="result-panel-header">{liveMode ? 'Live result' : 'Scan result'}</div>
            <div className="result-panel-body">
              <p>{result.text}</p>
              {(result.totalMs > 0 || result.meta) && (
                <div className="message-stats">
                  {result.meta ? `${result.meta} - ` : ''}
                  {result.totalMs > 0 ? `${(result.totalMs / 1000).toFixed(1)}s` : ''}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
