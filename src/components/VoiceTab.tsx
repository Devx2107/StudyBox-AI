import { useState, useRef, useCallback, useEffect } from 'react';
import { VoicePipeline, ModelCategory, ModelManager, AudioCapture, AudioPlayback, SpeechActivity } from '@runanywhere/web';
import { VAD } from '@runanywhere/web-onnx';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { MarkdownContent } from './MarkdownContent';
import type { HistoryReporter } from '../types/history';

type VoiceState = 'idle' | 'loading-models' | 'listening' | 'processing' | 'speaking';

interface VoiceTabProps extends HistoryReporter {
  languageModelId?: string;
}

function computeSignalLevel(samples: Float32Array) {
  if (!samples.length) return 0;

  let peak = 0;
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index] ?? 0);
    peak = Math.max(peak, value);
    total += value * value;
  }

  const rms = Math.sqrt(total / samples.length);
  return Math.min(1, Math.max(peak * 1.8, rms * 5.5));
}

export function VoiceTab({ onHistoryEntry, languageModelId }: VoiceTabProps) {
  const llmLoader = useModelLoader(ModelCategory.Language, true, languageModelId);
  const sttLoader = useModelLoader(ModelCategory.SpeechRecognition, true);
  const ttsLoader = useModelLoader(ModelCategory.SpeechSynthesis, true);
  const vadLoader = useModelLoader(ModelCategory.Audio, true);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const micRef = useRef<AudioCapture | null>(null);
  const pipelineRef = useRef<VoicePipeline | null>(null);
  const vadUnsub = useRef<(() => void) | null>(null);
  const playbackAnimRef = useRef<number | null>(null);
  const lastVisualLevelRef = useRef(0);

  const stopPlaybackAnimation = useCallback(() => {
    if (playbackAnimRef.current !== null) {
      window.clearInterval(playbackAnimRef.current);
      playbackAnimRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      vadUnsub.current?.();
      stopPlaybackAnimation();
    };
  }, [stopPlaybackAnimation]);

  const ensureModels = useCallback(async (): Promise<boolean> => {
    setVoiceState('loading-models');
    setError(null);

    const results = await Promise.all([
      vadLoader.ensure(),
      sttLoader.ensure(),
      llmLoader.ensure(),
      ttsLoader.ensure(),
    ]);

    if (results.every(Boolean)) {
      setVoiceState('idle');
      return true;
    }

    setError('Failed to load one or more voice models');
    setVoiceState('idle');
    return false;
  }, [vadLoader, sttLoader, llmLoader, ttsLoader]);

  const processSpeech = useCallback(async (audioData: Float32Array) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    let latestTranscript = '';

    micRef.current?.stop();
    vadUnsub.current?.();
    setVoiceState('processing');

    try {
      const result = await pipeline.processTurn(audioData, {
        maxTokens: 40,
        temperature: 0.45,
        systemPrompt: 'You are a helpful voice assistant. Keep responses concise - 1-2 sentences max.',
      }, {
        onTranscription: (text) => {
          latestTranscript = text;
          setTranscript(text);
        },
        onResponseToken: (_token, accumulated) => {
          setResponse(accumulated);
        },
        onResponseComplete: (text) => {
          setResponse(text);
        },
        onSynthesisComplete: async (audio, sampleRate) => {
          setVoiceState('speaking');
          const chunkSize = Math.max(512, Math.floor(sampleRate * 0.05));
          const envelope = Array.from({ length: Math.max(1, Math.ceil(audio.length / chunkSize)) }, (_, index) => {
            const start = index * chunkSize;
            const end = Math.min(start + chunkSize, audio.length);
            return computeSignalLevel(audio.slice(start, end));
          });

          stopPlaybackAnimation();
          let envelopeIndex = 0;
          playbackAnimRef.current = window.setInterval(() => {
            const rawLevel = envelope[envelopeIndex] ?? 0;
            const nextLevel = Math.max(0.08, rawLevel);
            lastVisualLevelRef.current = nextLevel;
            setAudioLevel(nextLevel);
            envelopeIndex += 1;
            if (envelopeIndex >= envelope.length) {
              stopPlaybackAnimation();
            }
          }, 50);

          const player = new AudioPlayback({ sampleRate });
          await player.play(audio, sampleRate);
          player.dispose();
          stopPlaybackAnimation();
          setAudioLevel(0);
        },
        onStateChange: (s) => {
          if (s === 'processingSTT' || s === 'generatingResponse') setVoiceState('processing');
          if (s === 'playingTTS') setVoiceState('speaking');
        },
      });

      if (result) {
        setTranscript(result.transcription);
        setResponse(result.response);
        onHistoryEntry?.({
          source: 'voice',
          prompt: result.transcription,
          response: result.response,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      const prompt = latestTranscript.trim();
      if (prompt) {
        onHistoryEntry?.({ source: 'voice', prompt, response: `Error: ${msg}` });
      }
    }

    setVoiceState('idle');
    setAudioLevel(0);
  }, [onHistoryEntry]);

  const startListening = useCallback(async () => {
    setTranscript('');
    setResponse('');
    setError(null);

    const anyMissing = !ModelManager.getLoadedModel(ModelCategory.Audio)
      || !ModelManager.getLoadedModel(ModelCategory.SpeechRecognition)
      || !ModelManager.getLoadedModel(ModelCategory.Language)
      || !ModelManager.getLoadedModel(ModelCategory.SpeechSynthesis);

    if (anyMissing) {
      const ok = await ensureModels();
      if (!ok) return;
    }

    setVoiceState('listening');
    lastVisualLevelRef.current = 0;

    const mic = new AudioCapture({ sampleRate: 16000 });
    micRef.current = mic;

    if (!pipelineRef.current) {
      pipelineRef.current = new VoicePipeline();
    }

    VAD.reset();

    vadUnsub.current = VAD.onSpeechActivity((activity) => {
      if (activity === SpeechActivity.Ended) {
        const segment = VAD.popSpeechSegment();
        if (segment && segment.samples.length > 1600) {
          void processSpeech(segment.samples);
        }
      }
    });

    await mic.start(
      (chunk) => {
        VAD.processSamples(chunk);
        const rawLevel = computeSignalLevel(chunk);
        const smoothedLevel = rawLevel > lastVisualLevelRef.current
          ? rawLevel
          : lastVisualLevelRef.current * 0.72 + rawLevel * 0.28;
        lastVisualLevelRef.current = smoothedLevel;
        setAudioLevel(smoothedLevel);
      },
      () => {},
    );
  }, [ensureModels, processSpeech]);

  const stopListening = useCallback(() => {
    micRef.current?.stop();
    vadUnsub.current?.();
    stopPlaybackAnimation();
    lastVisualLevelRef.current = 0;
    setVoiceState('idle');
    setAudioLevel(0);
  }, [stopPlaybackAnimation]);

  const pendingLoaders = [
    { label: 'VAD', loader: vadLoader },
    { label: 'STT', loader: sttLoader },
    { label: 'LLM', loader: llmLoader },
    { label: 'TTS', loader: ttsLoader },
  ].filter((l) => l.loader.state !== 'ready');

  const voiceStatusLabel = (
    voiceState === 'idle' ? 'Stopped'
      : voiceState === 'loading-models' ? 'Loading models...'
        : voiceState === 'listening' ? 'Listening... speak now'
          : voiceState === 'processing' ? 'Processing...'
            : 'Speaking...'
  );

  const visualLevel = voiceState === 'idle' || voiceState === 'loading-models'
    ? 0
    : audioLevel;
  const waveProfile = [0.18, 0.28, 0.42, 0.58, 0.76, 0.94, 1, 0.94, 0.76, 0.58, 0.42, 0.28, 0.18];
  const waveBars = waveProfile.map((profile, index) => {
    const baseHeight = 14 + profile * 14;
    const activeLift = visualLevel * (10 + profile * 54);
    return {
      key: index,
      height: voiceState === 'idle' || voiceState === 'loading-models' ? 12 : baseHeight + activeLift,
      opacity: voiceState === 'idle' ? 0.45 : 0.62 + profile * 0.34,
    };
  });

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Voice interface</div>
        <div className="card-badge">{voiceState}</div>
      </div>

      {pendingLoaders.length > 0 && voiceState === 'idle' && (
        <ModelBanner
          state={pendingLoaders[0].loader.state}
          progress={pendingLoaders[0].loader.progress}
          error={pendingLoaders[0].loader.error}
          onLoad={ensureModels}
          label={`Voice (${pendingLoaders.map((l) => l.label).join(', ')})`}
        />
      )}

      <div className="card-body voice-layout">
        {error && (
          <div className="result-panel">
            <div className="result-panel-header">Voice error</div>
            <div className="result-panel-body">
              <span className="error-text">{error}</span>
            </div>
          </div>
        )}

        <div className="voice-grid">
          <div className="voice-center">
            <div className="waveform" aria-hidden="true">
              {waveBars.map((bar) => (
                <span
                  key={bar.key}
                  className="wave-bar"
                  style={{
                    height: `${bar.height}px`,
                    opacity: bar.opacity,
                  }}
                />
              ))}
            </div>

            <p className="voice-status">{voiceStatusLabel}</p>

            {voiceState === 'idle' || voiceState === 'loading-models' ? (
              <button
                className="btn primary"
                onClick={startListening}
                disabled={voiceState === 'loading-models'}
                type="button"
              >
                Start Listening
              </button>
            ) : voiceState === 'listening' ? (
              <button className="btn pink" onClick={stopListening} type="button">
                Stop
              </button>
            ) : null}
          </div>

          <div className="info-block voice-pipeline-block">
            <div className="info-block-head">
              <span>Voice pipeline</span>
              <span>4 stages</span>
            </div>
            <div className="info-block-body voice-pipeline-list">
              <div className={`voice-pipeline-step ${voiceState === 'listening' ? 'active' : ''}`}>
                <span className="voice-pipeline-icon">Mic</span>
                <span>detect speech</span>
              </div>
              <div className={`voice-pipeline-step ${voiceState === 'processing' ? 'active' : ''}`}>
                <span className="voice-pipeline-icon">Text</span>
                <span>transcribe</span>
              </div>
              <div className={`voice-pipeline-step ${voiceState === 'processing' ? 'active' : ''}`}>
                <span className="voice-pipeline-icon">AI</span>
                <span>generate reply</span>
              </div>
              <div className={`voice-pipeline-step ${voiceState === 'speaking' ? 'active' : ''}`}>
                <span className="voice-pipeline-icon">Play</span>
                <span>speak response</span>
              </div>
            </div>
          </div>
        </div>

        {(transcript || response) && (
          <div className="voice-results-grid">
            {transcript && (
              <div className="result-panel">
                <div className="result-panel-header">You said</div>
                <div className="result-panel-body">
                  <p>{transcript}</p>
                </div>
              </div>
            )}

            {response && (
              <div className="result-panel">
                <div className="result-panel-header">AI response</div>
                <div className="result-panel-body">
                  <MarkdownContent className="markdown-content" content={response} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
