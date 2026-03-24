import { useEffect, useMemo, useRef, useState } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { MarkdownContent } from './MarkdownContent';
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

interface PositionedNode extends MapNode {
  x: number;
  y: number;
  type: 'center' | 'branch' | 'leaf';
}

interface ConceptMapTabProps {
  history: HistoryEntry[];
  selectedHistory: HistoryEntry | null;
  notes: string;
  languageModelId?: string;
}

function sanitizeConceptMap(map: ConceptMap): ConceptMap {
  const nodes = map.nodes
    .filter((node) => node.id && node.label)
    .slice(0, 8)
    .map((node) => ({
      id: node.id,
      label: node.label.trim(),
      detail: node.detail?.trim() || node.label.trim(),
    }));

  const validIds = new Set(nodes.map((node) => node.id));
  const edges = map.edges
    .filter((edge) => validIds.has(edge.from) && validIds.has(edge.to) && edge.from !== edge.to)
    .slice(0, 12);

  return {
    title: map.title?.trim() || 'Concept map',
    nodes,
    edges,
  };
}

function parseConceptMap(raw: string): ConceptMap | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ConceptMap;
    if (!parsed.title || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return null;
    }
    const sanitized = sanitizeConceptMap(parsed);
    return sanitized.nodes.length >= 3 ? sanitized : null;
  } catch {
    return null;
  }
}

function buildFallbackMap(sourceText: string): ConceptMap {
  const fragments = sourceText
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 6);

  const title = fragments[0]?.slice(0, 48) || 'Study topic';
  const nodes: MapNode[] = [
    { id: 'root', label: title, detail: title },
    ...fragments.slice(1, 6).map((fragment, index) => ({
      id: `n${index + 1}`,
      label: fragment.slice(0, 28),
      detail: fragment,
    })),
  ];

  return {
    title,
    nodes,
    edges: nodes.slice(1).map((node) => ({ from: 'root', to: node.id })),
  };
}

function positionConceptMap(map: ConceptMap): PositionedNode[] {
  const [root, ...rest] = map.nodes;
  if (!root) return [];

  return [
    { ...root, x: 50, y: 50, type: 'center' as const },
    ...rest.map((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(rest.length, 1);
      const distance = index % 2 === 0 ? 30 : 38;
      const x = 50 + Math.cos(angle) * distance;
      const y = 50 + Math.sin(angle) * distance;
      return {
        ...node,
        x,
        y,
        type: index < 3 ? 'branch' as const : 'leaf' as const,
      };
    }),
  ];
}

export function ConceptMapTab({ history, selectedHistory, notes, languageModelId }: ConceptMapTabProps) {
  const loader = useModelLoader(ModelCategory.Language, false, languageModelId);
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
Rules:
- create 5 to 7 nodes
- keep labels short
- connect every node with meaningful edges
- the first node should be the main topic
\n\n${sourceText}`,
        { maxTokens: 420, temperature: 0.25 },
      );

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
      }
      const final = (await result).text || accumulated;
      const nextMap = parseConceptMap(final) ?? buildFallbackMap(sourceText);
      setMap(nextMap);
      setActiveNodeId(nextMap.nodes[0]?.id ?? null);
    } finally {
      setBusy(false);
    }
  };

  const resetMap = () => {
    setMap(null);
    setActiveNodeId(null);
  };

  const positionedNodes = map ? positionConceptMap(map) : [];
  const nodeMap = Object.fromEntries(positionedNodes.map((node) => [node.id, node]));
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

      <div className="card-body concept-map-layout">
        <div className="concept-map-main">
          {map ? (
            <>
              <div className="mindmap-canvas">
                <div className="mindmap-grid" />
                <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                  {map.edges.map((edge) => {
                    const from = nodeMap[edge.from];
                    const to = nodeMap[edge.to];
                    if (!from || !to) return null;
                    return (
                      <line
                        key={`${edge.from}-${edge.to}`}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={to.type === 'leaf' ? '#00f5d4' : '#ffe600'}
                        strokeWidth={to.type === 'leaf' ? 0.4 : 0.7}
                        strokeDasharray={to.type === 'leaf' ? '1.5 1' : undefined}
                      />
                    );
                  })}
                </svg>

                {positionedNodes.map((node) => (
                  <button
                    key={node.id}
                    className={`mindmap-node node-${node.type} ${activeNodeId === node.id ? 'active' : ''}`}
                    style={{ left: `${node.x}%`, top: `${node.y}%` }}
                    type="button"
                    onClick={() => setActiveNodeId(node.id)}
                  >
                    {node.label}
                  </button>
                ))}
              </div>

              <div className="study-toolbar">
                <button className="btn primary" type="button" onClick={generateMap} disabled={busy || !sourceText.trim()}>
                  {busy ? 'Building...' : 'Generate concept map'}
                </button>
                <button className="btn" type="button" onClick={resetMap}>Reset map</button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h3>No map yet</h3>
              <p>Generate a visual concept map from notes, chat history, or selected study material.</p>
            </div>
          )}
        </div>

        <div className="info-stack">
          <div className="info-block">
            <div className="info-block-head">
              <span>Map source</span>
              <span>{map?.title ?? 'ready'}</span>
            </div>
            <div className="info-block-body concept-map-side-body">
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
              </div>
            </div>
          </div>

          {activeNode && (
            <div className="result-panel">
              <div className="result-panel-header">Node detail</div>
              <div className="result-panel-body">
                <p><strong>{activeNode.label}</strong></p>
                <MarkdownContent className="markdown-content" content={activeNode.detail} />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
