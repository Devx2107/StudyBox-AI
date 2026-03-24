import { useMemo } from 'react';
import { ModelCategory, ModelManager } from '@runanywhere/web';
import type { CompactModelDef } from '@runanywhere/web';

interface OptionItem {
  id: string;
  label: string;
}

interface SettingsTabProps {
  theme: string;
  themes: OptionItem[];
  onThemeChange: (value: string) => void;
  providerMode: 'local' | 'hybrid' | 'claude';
  onProviderModeChange: (value: 'local' | 'hybrid' | 'claude') => void;
  claudeApiKey: string;
  onClaudeApiKeyChange: (value: string) => void;
  claudeModel: string;
  claudeModels: OptionItem[];
  onClaudeModelChange: (value: string) => void;
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

export function SettingsTab({
  theme,
  themes,
  onThemeChange,
  providerMode,
  onProviderModeChange,
  claudeApiKey,
  onClaudeApiKeyChange,
  claudeModel,
  claudeModels,
  onClaudeModelChange,
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

  const openHardwarePage = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

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
            <span>Provider</span>
            <span>{providerMode}</span>
          </div>
          <div className="info-block-body settings-body">
            <div className="provider-switcher">
              {(['local', 'hybrid', 'claude'] as const).map((mode) => (
                <button
                  key={mode}
                  className={`theme-chip ${providerMode === mode ? 'active' : ''}`}
                  onClick={() => onProviderModeChange(mode)}
                  type="button"
                >
                  {mode}
                </button>
              ))}
            </div>

            <label className="settings-field">
              <span className="settings-label">Claude API key</span>
              <input
                className="history-search"
                type="password"
                placeholder="Paste Claude API key"
                value={claudeApiKey}
                onChange={(e) => onClaudeApiKeyChange(e.target.value)}
              />
            </label>

            <label className="settings-field">
              <span className="settings-label">Claude model</span>
              <select
                className="history-search"
                value={claudeModel}
                onChange={(e) => onClaudeModelChange(e.target.value)}
              >
                {claudeModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            <p className="provider-note">Local keeps everything on-device. Hybrid prefers local and falls back to Claude. Claude uses your API key for text and image tasks.</p>
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
              <select
                className="history-search"
                value={preferredLanguageModelId}
                onChange={(e) => onPreferredLanguageModelChange(e.target.value)}
              >
                <option value="">Auto-select lightest model</option>
                {languageModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-label">Vision model</span>
              <select
                className="history-search"
                value={preferredVisionModelId}
                onChange={(e) => onPreferredVisionModelChange(e.target.value)}
              >
                <option value="">Auto-select lightest model</option>
                {visionModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
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

            <div className="settings-actions">
              <button className="btn" type="button" onClick={() => openHardwarePage('chrome://settings/system')}>
                Chrome system settings
              </button>
              <button className="btn" type="button" onClick={() => openHardwarePage('edge://settings/system')}>
                Edge system settings
              </button>
            </div>

            <p className="provider-note">If your browser blocks those internal pages, open your browser settings manually and enable hardware acceleration, then restart the browser.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
