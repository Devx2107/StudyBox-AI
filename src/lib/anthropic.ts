export interface ClaudeSettings {
  apiKey: string;
  model: string;
}

interface ClaudeTextOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text?: string } => Boolean(block && typeof block === 'object'))
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');
}

function ensureClaudeSettings(settings: ClaudeSettings) {
  if (!settings.apiKey.trim()) {
    throw new Error('Claude API key missing. Add it in the Provider panel.');
  }
}

export async function generateClaudeText(prompt: string, settings: ClaudeSettings, options: ClaudeTextOptions = {}) {
  ensureClaudeSettings(settings);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': settings.apiKey.trim(),
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.4,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message
      : `Claude request failed (${response.status})`;
    throw new Error(message);
  }

  return {
    text: extractTextContent(payload?.content),
    usage: payload?.usage as { input_tokens?: number; output_tokens?: number } | undefined,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read image file.'));
        return;
      }
      const [, base64 = ''] = result.split(',', 2);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

export async function analyzeClaudeImage(prompt: string, file: File, settings: ClaudeSettings, options: ClaudeTextOptions = {}) {
  ensureClaudeSettings(settings);
  const base64 = await fileToBase64(file);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': settings.apiKey.trim(),
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: options.maxTokens ?? 700,
      temperature: options.temperature ?? 0.3,
      system: options.systemPrompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: file.type || 'image/png',
              data: base64,
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message
      : `Claude vision request failed (${response.status})`;
    throw new Error(message);
  }

  return {
    text: extractTextContent(payload?.content),
    usage: payload?.usage as { input_tokens?: number; output_tokens?: number } | undefined,
  };
}
