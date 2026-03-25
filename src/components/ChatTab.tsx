import { useState, useRef, useEffect, useCallback } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { MarkdownContent } from './MarkdownContent';
import type { HistoryReporter } from '../types/history';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  stats?: { summary: string };
}

interface ChatTabProps extends HistoryReporter {
  languageModelId?: string;
  onPinAnswer?: (entry: { prompt: string; response: string }) => void;
}

export function ChatTab({ onHistoryEntry, languageModelId, onPinAnswer }: ChatTabProps) {
  const loader = useModelLoader(ModelCategory.Language, false, languageModelId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const setAssistantMessage = useCallback((assistantIdx: number, message: Message) => {
    setMessages((prev) => {
      const updated = [...prev];
      updated[assistantIdx] = message;
      return updated;
    });
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setGenerating(true);

    const assistantIdx = messages.length + 1;
    setMessages((prev) => [...prev, { role: 'assistant', text: '' }]);

    try {
      if (loader.state !== 'ready') {
        const ok = await loader.ensure();
        if (!ok) {
          throw new Error(loader.error || 'Could not load the local LLM.');
        }
      }

      const { stream, result: resultPromise, cancel } = await TextGeneration.generateStream(text, {
        maxTokens: 256,
        temperature: 0.45,
      });
      cancelRef.current = cancel;

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
        setAssistantMessage(assistantIdx, { role: 'assistant', text: accumulated });
      }

      const result = await resultPromise;
      const finalText = result.text || accumulated;
      const statsSummary = `${result.tokensUsed} tokens - ${result.tokensPerSecond.toFixed(1)} tok/s - ${result.latencyMs.toFixed(0)}ms`;

      setAssistantMessage(assistantIdx, {
        role: 'assistant',
        text: finalText,
        stats: { summary: statsSummary },
      });
      onHistoryEntry?.({ source: 'chat', prompt: text, response: finalText });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAssistantMessage(assistantIdx, { role: 'assistant', text: `Error: ${msg}` });
      onHistoryEntry?.({ source: 'chat', prompt: text, response: `Error: ${msg}` });
    } finally {
      cancelRef.current = null;
      setGenerating(false);
    }
  }, [input, generating, messages.length, loader, onHistoryEntry, setAssistantMessage]);

  const handleCancel = () => {
    cancelRef.current?.();
  };

  const conversationText = messages
    .filter((message) => message.text.trim())
    .map((message) => `${message.role === 'user' ? 'You' : 'StudyBox-AI'}: ${message.text}`)
    .join('\n\n');

  const exportConversation = (format: 'md' | 'txt') => {
    if (!conversationText) return;

    const content = format === 'md'
      ? [
          '# StudyBox-AI Chat Export',
          '',
          ...messages
            .filter((message) => message.text.trim())
            .flatMap((message) => [
              `## ${message.role === 'user' ? 'You' : 'StudyBox-AI'}`,
              '',
              message.text,
              '',
            ]),
        ].join('\n')
      : conversationText;

    const blob = new Blob([content], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `studybox-ai-chat.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyConversation = async () => {
    if (!conversationText) return;
    await navigator.clipboard.writeText(conversationText);
  };

  const shareConversation = async () => {
    if (!conversationText) return;

    if (navigator.share) {
      await navigator.share({
        title: 'StudyBox-AI Chat',
        text: conversationText,
      });
      return;
    }

    await copyConversation();
  };

  const pinMessage = (index: number) => {
    const message = messages[index];
    if (!message || message.role !== 'assistant' || !message.text.trim()) return;

    let prompt = 'Pinned answer';
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user' && messages[i].text.trim()) {
        prompt = messages[i].text;
        break;
      }
    }

    onPinAnswer?.({ prompt, response: message.text });
  };

  const chatBadge = loader.state === 'ready'
    ? 'LLM streaming'
    : loader.state === 'downloading'
      ? 'LLM downloading'
      : loader.state === 'loading'
        ? 'LLM loading'
        : loader.state === 'error'
          ? 'LLM error'
          : 'LLM not loaded';

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Chat console</div>
        <div className="chat-header-tools">
          <button className="chat-header-btn" type="button" onClick={copyConversation} disabled={!conversationText}>
            Copy Chat
          </button>
          <button className="chat-header-btn" type="button" onClick={shareConversation} disabled={!conversationText}>
            Share Chat
          </button>
          <button className="chat-header-btn" type="button" onClick={() => exportConversation('txt')} disabled={!conversationText}>
            Export .txt
          </button>
          <button className="chat-header-btn" type="button" onClick={() => exportConversation('md')} disabled={!conversationText}>
            Export .md
          </button>
          <div className="card-badge">{chatBadge}</div>
        </div>
      </div>

      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM"
      />

      <div className="card-body">
        <div className="messages" ref={listRef}>
          {messages.length === 0 && (
            <div className="empty-state">
              <h3>Start a conversation</h3>
              <p>Type a message below to chat with the AI.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`msg ${msg.role}`}>
              <div className="msg-avatar">{msg.role === 'user' ? 'You' : 'AI'}</div>
              <div className="msg-stack">
                <div className="msg-bubble">
                  {msg.role === 'user' ? (
                    <div className="msg-text">{msg.text || '...'}</div>
                  ) : (
                    <MarkdownContent
                      className="markdown-content chat-markdown"
                      content={msg.text || '...'}
                    />
                  )}
                  {msg.stats && (
                    <div className="message-stats">
                      {msg.stats.summary}
                    </div>
                  )}
                </div>
                {msg.role === 'assistant' && msg.text.trim() && (
                  <div className="msg-actions">
                    <button className="msg-action-btn" type="button" onClick={() => pinMessage(i)}>
                      Pin Answer
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <form
          className="chat-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            className="chat-input"
            type="text"
            placeholder="Message the model..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={generating}
          />
          {generating ? (
            <button type="button" className="send-btn" onClick={handleCancel}>
              Stop
            </button>
          ) : (
            <button type="submit" className="send-btn" disabled={!input.trim()}>
              Send
            </button>
          )}
        </form>
      </div>
    </section>
  );
}
