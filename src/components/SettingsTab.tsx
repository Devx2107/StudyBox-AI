import { useMemo } from 'react';
import { ModelCategory, ModelManager } from '@runanywhere/web';
import type { CompactModelDef } from '@runanywhere/web';
import { AppSelect } from './AppSelect';

interface OptionItem {
  id: string;
  label: string;
}

interface SettingsTabProps {
  theme: string;
  themes: OptionItem[];
  onThemeChange: (value: string) => void;
  preferredLanguageModelId: string;
  onPreferredLanguageModelChange: (value: string) => void;
  preferredVisionModelId: string;
  onPreferredVisionModelChange: (value: string) => void;
  accelerationMode: string | null;
}

function toModelOption(model: CompactModelDef) {
  return {
    id: model.id,
    label: `${model.name} (${Math.round((model.memoryRequirement ?? 0) / 1_000_000)} MB)`,
  };
}

function getBrowserInstructions() {
  if (typeof navigator === 'undefined') {
    return {
      name: 'Chrome / Edge',
      path: 'chrome://settings/system',
      note: 'Enable Use graphics acceleration when available and restart the browser.',
    };
  }

  const brands = 'userAgentData' in navigator
    ? ((navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands ?? [])
        .map((entry) => entry.brand.toLowerCase())
        .join(' ')
    : '';
  const ua = `${navigator.userAgent} ${brands}`.toLowerCase();

  if (ua.includes('edg/')) {
    return {
      name: 'Edge',
      path: 'edge://settings/system/manageSystem',
      note: 'Enable Use graphics acceleration when available and restart the browser.',
    };
  }

  return {
    name: 'Chrome / related browser',
    path: 'chrome://settings/system',
    note: 'Enable Use graphics acceleration when available and restart the browser.',
  };
}

export function SettingsTab({
  theme,
  themes,
  onThemeChange,
  preferredLanguageModelId,
  onPreferredLanguageModelChange,
  preferredVisionModelId,
  onPreferredVisionModelChange,
  accelerationMode,
}: SettingsTabProps) {
  const languageModels = useMemo(
    () => ModelManager.getModels()
      .filter((model) => model.modality === ModelCategory.Language)
      .sort((a, b) => (a.memoryRequirement ?? Number.MAX_SAFE_INTEGER) - (b.memoryRequirement ?? Number.MAX_SAFE_INTEGER))
      .map(toModelOption),
    [],
  );

  const visionModels = useMemo(
    () => ModelManager.getModels()
      .filter((model) => model.modality === ModelCategory.Multimodal)
      .sort((a, b) => (a.memoryRequirement ?? Number.MAX_SAFE_INTEGER) - (b.memoryRequirement ?? Number.MAX_SAFE_INTEGER))
      .map(toModelOption),
    [],
  );
  const browserInstructions = useMemo(() => getBrowserInstructions(), []);

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Settings</div>
        <div className="card-badge">runtime + profile</div>
      </div>

      <div className="card-body settings-layout">
        <div className="info-block settings-section">
          <div className="info-block-head">
            <span>Appearance</span>
            <span>{theme}</span>
          </div>
          <div className="info-block-body settings-body">
            <div className="theme-switcher">
              {themes.map((themeOption) => (
                <button
                  key={themeOption.id}
                  className={`theme-chip ${theme === themeOption.id ? 'active' : ''}`}
                  onClick={() => onThemeChange(themeOption.id)}
                  type="button"
                >
                  {themeOption.label}
                </button>
              ))}
            </div>
            <p className="provider-note">Theme changes are saved in this browser and applied across the whole workspace.</p>
          </div>
        </div>

        <div className="info-block settings-section">
          <div className="info-block-head">
            <span>Model selection</span>
            <span>local runtime</span>
          </div>
          <div className="info-block-body settings-body">
            <label className="settings-field">
              <span className="settings-label">Language model</span>
              <AppSelect
                value={preferredLanguageModelId}
                onChange={onPreferredLanguageModelChange}
                ariaLabel="Language model"
                options={[
                  { value: '', label: 'Auto-select lightest model' },
                  ...languageModels.map((model) => ({ value: model.id, label: model.label })),
                ]}
              />
            </label>

            <label className="settings-field">
              <span className="settings-label">Vision model</span>
              <AppSelect
                value={preferredVisionModelId}
                onChange={onPreferredVisionModelChange}
                ariaLabel="Vision model"
                options={[
                  { value: '', label: 'Auto-select lightest model' },
                  ...visionModels.map((model) => ({ value: model.id, label: model.label })),
                ]}
              />
            </label>

            <p className="provider-note">These preferences affect local chat, notes, flashcards, quizzes, concept maps, voice response generation, and vision analysis.</p>
          </div>
        </div>

        <div className="info-block settings-section">
          <div className="info-block-head">
            <span>Acceleration</span>
            <span>{accelerationMode ?? 'detecting'}</span>
          </div>
          <div className="info-block-body settings-body">
            <div className="settings-runtime">
              <div className="streak-stat">
                <strong>{accelerationMode ?? '--'}</strong>
                <span>Current runtime</span>
              </div>
              <div className="streak-stat">
                <strong>WebGPU</strong>
                <span>Preferred acceleration</span>
              </div>
            </div>

            <div className="settings-instructions">
              <p className="settings-instruction-note"><strong>{browserInstructions.name} instructions</strong></p>
              <p className="settings-instruction-note">Go to <strong><code>{browserInstructions.path}</code></strong>.</p>
              <p className="settings-instruction-note">Enable <strong><code>Use graphics acceleration when available</code></strong>.</p>
              <p className="settings-instruction-note">Restart the browser after changing it.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
