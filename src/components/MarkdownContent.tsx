import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { createElement, memo, useMemo, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import { useReducedMotion } from '../hooks/useMotion';

interface StreamMotion {
  id: number | string;
  active: boolean;
  mode?: 'tokens' | 'blocks';
}

interface MotionNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MotionNode[];
}

interface Arrival { start: number; end: number; at: number }

type MotionElementProps = HTMLAttributes<HTMLElement> & { node?: unknown; 'data-motion-id'?: string; 'data-motion-at'?: number };
function motionElement(tag: string) {
  return function MotionElement({ node: _node, ...props }: MotionElementProps) {
    const arrival = props['data-motion-at'];
    // Keep the initial delay for this mount. Updating it on every token would
    // accelerate an already running fade. A remount resumes at the proper age.
    const elapsed = useMemo(() => arrival === undefined ? 0 : Math.max(0, performance.now() - arrival), [arrival, props['data-motion-id']]);
    return createElement(tag, { ...props, style: arrival === undefined ? props.style : {
      ...props.style, '--motion-elapsed': `-${elapsed}ms`,
    } as CSSProperties });
  };
}
const motionComponents: Components = {
  span: motionElement('span'), h1: motionElement('h1'), h2: motionElement('h2'),
  h3: motionElement('h3'), h4: motionElement('h4'), h5: motionElement('h5'),
  h6: motionElement('h6'), li: motionElement('li'),
};

// Decorate parsed text, never the Markdown source. Source offsets keep earlier
// tokens stable; negative delays prevent replay if Markdown reparses a block.
function decorateMotion(tree: MotionNode, content: string, arrivals: Arrival[], mode: 'tokens' | 'blocks', blocks: Map<string, number>) {
  const now = performance.now();
  const visit = (node: MotionNode, insideMath = false) => {
    const classes = String(node.properties?.className ?? '');
    if (insideMath || /katex|math-inline|math-display|language-math/.test(classes)) return;
    const offset = node.position?.start.offset ?? 0;
    if (mode === 'blocks' && node.tagName && /^(h[1-6]|li)$/.test(node.tagName)) {
      const id = `${node.tagName}:${offset}`;
      if (!blocks.has(id)) blocks.set(id, now);
      node.properties = { ...node.properties, className: `${classes} motion-note-block`,
        'data-motion-id': id, 'data-motion-at': blocks.get(id)! };
    }
    if (!node.children) return;
    let searchFrom = offset;
    node.children = node.children.flatMap((child): MotionNode[] => {
      if (mode !== 'tokens' || child.type !== 'text' || !child.value) {
        visit(child);
        return [child];
      }
      const start = child.position?.start.offset ?? content.indexOf(child.value, searchFrom);
      if (start < 0 || content.slice(start, start + child.value.length) !== child.value) return [child];
      const end = start + child.value.length;
      searchFrom = end;
      const pieces: MotionNode[] = [];
      let cursor = start;
      // Only inspect ranges overlapping this text node. Long streams contain
      // many earlier ranges that cannot contribute to the current node.
      let low = 0;
      let high = arrivals.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (arrivals[middle].end <= start) low = middle + 1;
        else high = middle;
      }
      for (let index = low; index < arrivals.length && arrivals[index].start < end; index += 1) {
        const arrival = arrivals[index];
        const left = Math.max(cursor, arrival.start);
        const right = Math.min(end, arrival.end);
        if (right <= left) continue;
        if (left > cursor) pieces.push({ type: 'text', value: content.slice(cursor, left) });
        pieces.push({ type: 'element', tagName: 'span', properties: {
          className: 'motion-token', 'data-motion-id': `${arrival.start}:${left}`,
          'data-motion-at': arrival.at,
        }, children: [{ type: 'text', value: content.slice(left, right) }] });
        cursor = right;
      }
      if (cursor < end) pieces.push({ type: 'text', value: content.slice(cursor, end) });
      return pieces.length ? pieces : [child];
    });
  };
  visit(tree);
}

interface MarkdownContentProps {
  content: string;
  className?: string;
  motion?: StreamMotion;
}

export const MarkdownContent = memo(function MarkdownContent({ content, className, motion }: MarkdownContentProps) {
  const reduced = useReducedMotion();
  const cache = useRef<{ id: StreamMotion['id'] | undefined; content: string; arrivals: Arrival[]; blocks: Map<string, number> }>({
    id: undefined, content: '', arrivals: [], blocks: new Map(),
  });
  const motionPlugin = useMemo(() => {
    if (!motion || reduced) return null;
    if (cache.current.id !== motion.id || !content.startsWith(cache.current.content)) {
      cache.current = { id: motion.id, content: '', arrivals: [], blocks: new Map() };
    }
    if (content.length > cache.current.content.length && motion.active) {
      cache.current.arrivals.push({ start: cache.current.content.length, end: content.length, at: performance.now() });
    }
    cache.current.content = content;
    const { arrivals, blocks } = cache.current;
    return () => (tree: unknown) => decorateMotion(tree as MotionNode, content, arrivals, motion.mode ?? 'tokens', blocks);
  }, [content, motion?.id, motion?.active, motion?.mode, reduced]);
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={motionPlugin ? [motionPlugin, rehypeKatex] : [rehypeKatex]}
        components={motionPlugin ? motionComponents : undefined}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}, (previous, next) => previous.content === next.content && previous.className === next.className
  && previous.motion?.id === next.motion?.id && previous.motion?.active === next.motion?.active && previous.motion?.mode === next.motion?.mode);
