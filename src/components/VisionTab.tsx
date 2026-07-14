import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { ModelCategory, VideoCapture } from '@runanywhere/web';
import { VLMWorkerBridge } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { MarkdownContent } from './MarkdownContent';
import type { HistoryReporter } from '../types/history';

const SINGLE_MAX_TOKENS = 56;
const CAPTURE_DIM = 256;
const DEFAULT_VISION_SYSTEM_PROMPT = `Analyze the image and solve within 1 line.`;
const VISION_HISTORY_PROMPT = 'Analyze image';

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
  visionModelId?: string;
}

interface MediaDimensions {
  width: number;
  height: number;
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

async function readImageDimensions(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode the selected image.'));
      img.src = objectUrl;
    });

    return { width: image.width, height: image.height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function VisionTab({ onHistoryEntry, visionModelId }: VisionTabProps) {
  const loader = useModelLoader(ModelCategory.Multimodal, false, visionModelId);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [sourceDimensions, setSourceDimensions] = useState<MediaDimensions>({ width: 640, height: 360 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoMountRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<VideoCapture | null>(null);
  const processingRef = useRef(false);

  processingRef.current = processing;

  const stopCamera = useCallback(() => {
    const cam = captureRef.current;
    if (!cam) return;
    cam.stop();
    cam.videoElement.parentNode?.removeChild(cam.videoElement);
    captureRef.current = null;
    setCameraActive(false);
    setSourceDimensions({ width: 640, height: 360 });
  }, []);

  const startCamera = useCallback(async () => {
    if (captureRef.current?.isCapturing) return;

    setError(null);
    setUploadedImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });

    try {
      const cam = new VideoCapture({
        facingMode: 'environment',
        idealWidth: 1280,
        idealHeight: 720,
      });
      await cam.start();
      captureRef.current = cam;
      if (cam.videoWidth > 0 && cam.videoHeight > 0) {
        setSourceDimensions({ width: cam.videoWidth, height: cam.videoHeight });
      }
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
    el.style.objectFit = 'contain';

    if (el.parentNode !== mount) {
      mount.replaceChildren(el);
    }

    const syncDimensions = () => {
      const width = el.videoWidth || capture.videoWidth;
      const height = el.videoHeight || capture.videoHeight;
      if (width > 0 && height > 0) {
        setSourceDimensions({ width, height });
      }
    };

    syncDimensions();
    el.addEventListener('loadedmetadata', syncDimensions);
    el.addEventListener('resize', syncDimensions);

    return () => {
      el.removeEventListener('loadedmetadata', syncDimensions);
      el.removeEventListener('resize', syncDimensions);
    };
  }, [cameraActive, processing, result, error]);

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
      '',
      {
        maxTokens,
        temperature: 0.35,
        systemPrompt: DEFAULT_VISION_SYSTEM_PROMPT,
      },
    );

    return {
      text: response.text,
      meta: 'Local VLM',
    };
  }, [loader]);

  const processUploadedImage = useCallback(async (file: File, maxTokens: number) => {
    const { rgbPixels, width, height } = await extractImagePixels(file, CAPTURE_DIM);
    return runLocalVision(rgbPixels, width, height, maxTokens);
  }, [runLocalVision]);

  const processCameraFrame = useCallback(async (maxTokens: number) => {
    const capture = captureRef.current;
    if (!capture?.isCapturing) {
      throw new Error('Start the camera or upload an image first.');
    }

    const frame = capture.captureFrame(CAPTURE_DIM);
    if (!frame) throw new Error('Could not capture a frame from the camera.');
    return runLocalVision(frame.rgbPixels, frame.width, frame.height, maxTokens);
  }, [runLocalVision]);

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

      const totalMs = performance.now() - startedAt;
      setResult({
        text: response.text,
        totalMs,
        meta: response.meta,
      });

      onHistoryEntry?.({ source: 'vision', prompt: VISION_HISTORY_PROMPT, response: response.text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isWasmCrash = msg.includes('memory access out of bounds') || msg.includes('RuntimeError');

      if (isWasmCrash) {
        setResult({ text: 'Recovering from memory error... next frame will retry.', totalMs: 0 });
      } else {
        setError(msg);
        onHistoryEntry?.({ source: 'vision', prompt: VISION_HISTORY_PROMPT, response: `Error: ${msg}` });
      }
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  }, [onHistoryEntry, processCameraFrame, processUploadedImage, uploadedImage]);

  const describeSingle = useCallback(async () => {
    if (!captureRef.current?.isCapturing && !uploadedImage) {
      await startCamera();
      return;
    }
    await runAnalysis(SINGLE_MAX_TOKENS);
  }, [startCamera, runAnalysis, uploadedImage]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    stopCamera();
    setError(null);
    setResult(null);

    const dimensions = await readImageDimensions(file);
    if (dimensions.width > 0 && dimensions.height > 0) {
      setSourceDimensions(dimensions);
    }

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
    setSourceDimensions({ width: 640, height: 360 });
  };

  const sourceLabel = cameraActive
    ? 'camera active'
    : uploadedImage
      ? 'uploaded image'
      : 'camera + upload ready';

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Vision workspace</div>
        <div className="vision-header-tools">
          <span className={`vision-header-pill ${cameraActive ? 'active' : ''}`}>camera</span>
          <span className={`vision-header-pill ${uploadedImage ? 'active' : ''}`}>upload</span>
          <div className="card-badge">camera + upload</div>
        </div>
      </div>

      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="VLM"
      />

      <div className="card-body">
        <div className="vision-workspace">
          <div className="camera-frame-shell">
            <div
              className="camera-frame"
              style={{ aspectRatio: `${sourceDimensions.width} / ${sourceDimensions.height}` }}
            >
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
                    <p>Start the camera or upload an image.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="vision-side-panel">
            <div className="vision-actions">
              <button
                className="btn primary vision-btn-alt"
                onClick={uploadedImage ? clearUploadedImage : () => fileInputRef.current?.click()}
                type="button"
                disabled={processing || cameraActive}
              >
                {uploadedImage ? 'Clear Image' : 'Upload Image'}
              </button>
              {!cameraActive ? (
                <button className="btn primary vision-btn-alt" onClick={startCamera} type="button" disabled={processing || Boolean(uploadedImage)}>
                  Start Camera
                </button>
              ) : (
                <button className="btn primary vision-btn-alt" onClick={stopCamera} type="button" disabled={processing}>
                  Stop Camera
                </button>
              )}
              <button
                className="btn primary"
                onClick={describeSingle}
                disabled={processing || (!cameraActive && !uploadedImage)}
                type="button"
              >
                {processing ? 'Analyzing...' : 'Analyze Image'}
              </button>
            </div>

            {result && (
              <div className="result-panel vision-result-panel">
                <div className="result-panel-header">Scan result</div>
                <div className="result-panel-body">
                  <MarkdownContent className="markdown-content" content={result.text} />
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
        </div>

        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
        />

        <p className="study-hint">
          This page handles both camera scans and uploaded study images. All processing runs fully on-device using the local VLM.
        </p>

        {error && (
          <div className="result-panel">
            <div className="result-panel-header">Vision error</div>
            <div className="result-panel-body">
              <span className="error-text">Error: {error}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
