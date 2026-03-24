import { useEffect, useMemo, useRef, useState } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import type { HistoryEntry } from '../types/history';

interface MapNode {
  id: string;
  label: string;
  detail: string;
}

interface MapEdge {
  from: string;
  to: string;
}

interface ConceptMap {
  title: string;
  nodes: MapNode[];
  edges: MapEdge[];
}

interface ConceptMapTabProps {
  history: HistoryEntry[];
  selectedHistory: HistoryEntry | null;
  notes: string;
}

function parseConceptMap(raw: string): ConceptMap | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as ConceptMap;
      if (parsed.title && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        return parsed;
      }
    } catch {
      // ignore parse failure
    }
  }
  return null;
}

export function ConceptMapTab({ history, selectedHistory, notes }: ConceptMapTabProps) {
  const loader = useModelLoader(ModelCategory.Language);
  const [busy, setBusy] = useState(false);
  const [map, setMap] = useState<ConceptMap | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const seedText = useMemo(() => {
    if (selectedHistory) return `Prompt: ${selectedHistory.prompt}\nResponse: ${selectedHistory.response}`;
    if (notes.trim()) return notes;
    return history.slice(0, 5).map((entry) => `${entry.prompt}\n${entry.response}`).join('\n\n');
  }, [selectedHistory, notes, history]);
  const [sourceText, setSourceText] = useState(seedText);
  const previousSeedRef = useRef(seedText);

  useEffect(() => {
    if (!sourceText.trim() || sourceText === previousSeedRef.current) {
      setSourceText(seedText);
    }
    previousSeedRef.current = seedText;
  }, [seedText, sourceText]);

  const useSelectedHistory = () => {
    if (!selectedHistory) return;
    setSourceText(`Prompt: ${selectedHistory.prompt}\nResponse: ${selectedHistory.response}`);
  };

  const useNotes = () => {
    if (!notes.trim()) return;
    setSourceText(notes);
  };

  const useRecentHistory = () => {
    setSourceText(history.slice(0, 5).map((entry) => `${entry.prompt}\n${entry.response}`).join('\n\n'));
  };

  const generateMap = async () => {
    if (!sourceText.trim() || busy) return;

    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    setBusy(true);
    try {
      const { stream, result } = await TextGeneration.generateStream(
        `Build a concept map from this study material. Return only JSON using this shape:
{"title":"topic","nodes":[{"id":"root","label":"Topic","detail":"summary"},{"id":"n2","label":"Idea","detail":"why it matters"}],"edges":[{"from":"root","to":"n2"}]}
Keep it to 5-7 nodes.\n\n${sourceText}`,
        { maxTokens: 340, temperature: 0.3 },
      );

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
      }
      const final = (await result).text || accumulated;
      const nextMap = parseConceptMap(final);
      if (nextMap) {
        setMap(nextMap);
        setActiveNodeId(nextMap.nodes[0]?.id ?? null);
      }
    } finally {
      setBusy(false);
    }
  };

  const activeNode = map?.nodes.find((node) => node.id === activeNodeId) ?? null;

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">Concept map</div>
        <div className="card-badge">{map?.nodes.length ?? 0} nodes</div>
      </div>

      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM"
      />

      <div className="card-body study-layout">
        <textarea
          className="study-textarea study-textarea-sm"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="Use a vision result, notes, or any study text to build a concept map."
        />

        <div className="study-toolbar">
          <button className="btn" type="button" onClick={useSelectedHistory} disabled={!selectedHistory}>
            Use selected history
          </button>
          <button className="btn" type="button" onClick={useNotes} disabled={!notes.trim()}>
            Use notes
          </button>
          <button className="btn" type="button" onClick={useRecentHistory} disabled={!history.length}>
            Use recent history
          </button>
          <button className="btn primary" type="button" onClick={generateMap} disabled={busy || !sourceText.trim()}>
            {busy ? 'Building...' : 'Build concept map'}
          </button>
        </div>
        <p className="study-hint">Use the current chat, notes, or recent study history as your map source without re-pasting content.</p>

        {!map && (
          <div className="empty-state">
            <h3>No map yet</h3>
            <p>Generate a mind map from a vision answer, notes, or any selected study content.</p>
          </div>
        )}

        {map && (
          <div className="concept-map-shell">
            <div className="concept-map-title">{map.title}</div>
            <div className="concept-map-grid">
              {map.nodes.map((node) => (
                <button
                  key={node.id}
                  className={`concept-node ${activeNodeId === node.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => setActiveNodeId(node.id)}
                >
                  <span>{node.label}</span>
                  <small>{map.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length} links</small>
                </button>
              ))}
            </div>

            {activeNode && (
              <div className="result-panel">
                <div className="result-panel-header">Node detail</div>
                <div className="result-panel-body">
                  <p><strong>{activeNode.label}</strong></p>
                  <p>{activeNode.detail}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
