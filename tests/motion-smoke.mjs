import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Uses an existing Playwright installation; adds no application dependencies.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STUDYBOX_PLAYWRIGHT_PATH ||
  'C:/Users/DevX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const realSdk = process.argv.includes('--real');
const template = JSON.parse(await readFile(new URL('../public/userdata.template.json', import.meta.url), 'utf8'));

// Model I/O is deterministic. Actual React components, Markdown parsing,
// persistence snapshots, CSS, lifecycle events, and browser layout are exercised.
const fixtures = {
  core: `
    export const ModelCategory = { Language: 'language', Multimodal: 'vision', SpeechRecognition: 'stt', SpeechSynthesis: 'tts', Audio: 'audio' };
    export const ModelManager = { getModels: () => Object.values(ModelCategory).map(modality => ({ id: modality, name: modality, modality, memoryRequirement: 1 })) };
    export const SpeechActivity = { Ended: 'ended' };
    export class VideoCapture { stop() {} }
    export class AudioCapture {
      async start(onChunk) { this.timer = setInterval(() => onChunk(new Float32Array(1600).fill(.15)), 25); }
      stop() { clearInterval(this.timer); }
    }
    export class AudioPlayback {
      play() { return new Promise(resolve => { this.resolve = resolve; this.timer = setTimeout(resolve, 650); }); }
      dispose() { clearTimeout(this.timer); this.resolve?.(); }
    }
    export class VoicePipeline {
      cancel() {}
      async processTurn(audio, options, callbacks) {
        callbacks.onTranscription('Motion test');
        callbacks.onResponseToken('Reply', 'Voice reply');
        callbacks.onResponseComplete('Voice reply');
        await callbacks.onSynthesisComplete(new Float32Array(10400).fill(.2), 16000);
        return { transcription: 'Motion test', response: 'Voice reply' };
      }
    }
  `,
  onnx: `
    let callback; let chunks = 0;
    export const VAD = {
      reset() { chunks = 0; },
      onSpeechActivity(cb) { callback = cb; return () => { callback = null; }; },
      popSpeechSegment() { return { samples: new Float32Array(2000) }; },
      processSamples() { if (++chunks === 16 && globalThis.__motionFixture.voiceTurn) callback?.('ended'); }
    };
  `,
  llm: `
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    function answer(prompt) {
      if (prompt.startsWith('Create') && prompt.includes('flashcards')) return JSON.stringify(Array.from({length: 8}, (_, index) => ({front: 'Question ' + (index + 1), back: 'Answer ' + (index + 1)})));
      if (prompt.includes('multiple-choice quiz')) return JSON.stringify({title: 'Motion quiz', questions: Array.from({length: 5}, (_, index) => ({ question: 'Question ' + (index + 1) + '?', options: ['Correct', 'Wrong', 'Other', 'Last'], answerIndex: 0, explanation: 'Because this is correct.' }))});
      if (prompt.includes('concept map')) return JSON.stringify({title: 'Motion map', nodes: Array.from({length: 6}, (_, index) => ({id: 'n' + index, label: 'Node ' + index, detail: 'Detail ' + index})), edges: [{from:'n0',to:'n1'},{from:'n0',to:'n2'},{from:'n1',to:'n3'},{from:'n2',to:'n4'},{from:'n2',to:'n5'}]});
      if (prompt.includes('Turn this study session')) return '# Study notes\\n\\n- First bullet\\n- Second bullet\\n\\n## Takeaways\\n\\n- Remember the lesson.';
      return '# Explanation\\n\\nA **bold** point with [a link](https://example.com).\\n\\n- First item\\n- Second item\\n\\nMath: $x^2$.\\n\\n\u0060\u0060\u0060js\\nconst answer = 42;\\n\u0060\u0060\u0060';
    }
    export const TextGeneration = { async generateStream(prompt) {
      const fixture = globalThis.__motionFixture;
      const text = fixture.nextText ?? answer(prompt);
      let cancelled = false; let accumulated = ''; let finish;
      const result = new Promise(resolve => { finish = resolve; });
      const outcome = () => ({text: accumulated, tokensUsed: 40, inputTokens: 10, tokensPerSecond: 20, latencyMs: 100});
      return {result, cancel() { cancelled = true; finish(outcome()); }, stream: (async function* () {
        try {
          const size = fixture.chunkSize ?? 12;
          for (let index = 0; index < text.length; index += size) {
            await delay(fixture.tokenDelay ?? 20);
            if (cancelled) return;
            if (fixture.generationError && index > 0) throw new Error('Fixture generation error');
            const token = text.slice(index, index + size);
            accumulated += token;
            yield token;
          }
        } finally { finish(outcome()); }
      })()};
    }};
    export const VLMWorkerBridge = {shared: {isModelLoaded: true, cancel() {}, async process() {
      await delay(400);
      if (globalThis.__motionFixture.visionError) throw new Error('Fixture vision error');
      return {text:'Image analysis complete'};
    }}};
  `,
  loader: `
    import { useCallback, useState } from 'react';
    export function useModelLoader() {
      const [state, setState] = useState('idle');
      const [progress, setProgress] = useState(0);
      const ensure = useCallback(async () => {
        setState('downloading'); setProgress(.5);
        await new Promise(resolve => setTimeout(resolve, 70));
        setState('loading');
        await new Promise(resolve => setTimeout(resolve, 70));
        const failed = globalThis.__motionFixture.loaderFailure;
        setState(failed ? 'error' : 'ready');
        return !failed;
      }, []);
      return {state, progress, error: state === 'error' ? 'Fixture load error' : null, getError: () => globalThis.__motionFixture.loaderFailure ? 'Fixture load error' : null, ensure};
    }
  `,
};

const server = await createServer({
  root, configFile: false,
  plugins: [...(realSdk ? [] : [{
    name: 'motion-test-fixtures', enforce: 'pre',
    resolveId(id) {
      const sdk = { '@runanywhere/web': 'core', '@runanywhere/web-llamacpp': 'llm', '@runanywhere/web-onnx': 'onnx' }[id];
      if (sdk) return '\0motion-fixture:' + sdk;
    },
    load(id) { if (id.startsWith('\0motion-fixture:')) return fixtures[id.slice('\0motion-fixture:'.length)]; },
    transform(code, id) {
      const path = id.replaceAll('\\', '/');
      if (path.endsWith('/src/runanywhere.ts')) return `export const DEFAULT_LANGUAGE_MODEL_ID = 'language'; export async function initSDK() {} export function getAccelerationMode() { return 'test'; }`;
      if (path.endsWith('/src/hooks/useModelLoader.ts')) return fixtures.loader;
    },
  }]), react()],
  optimizeDeps: { exclude: ['@runanywhere/web', '@runanywhere/web-llamacpp', '@runanywhere/web-onnx'] },
  server: { host: '127.0.0.1', port: 0, headers: {'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'} },
});
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ headless: true, channel: process.env.STUDYBOX_BROWSER_CHANNEL || 'msedge' });
const errors = [];
const checks = [];
const snapshots = [];
let page;
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); console.log('PASS ' + name); };

async function openPage({ reduced = false, mobile = false, data = {} } = {}) {
  if (page) await page.context().close();
  const context = await browser.newContext({ timezoneId:'Asia/Kolkata', viewport: mobile ? {width:390,height:844} : {width:1440,height:1000}, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    globalThis.__motionFixture = {};
    globalThis.__motionFrames = new Map();
    const request = globalThis.requestAnimationFrame.bind(globalThis);
    const cancel = globalThis.cancelAnimationFrame.bind(globalThis);
    globalThis.requestAnimationFrame = callback => {
      const frame = request(time => { globalThis.__motionFrames.delete(frame); callback(time); });
      globalThis.__motionFrames.set(frame, callback.name);
      return frame;
    };
    globalThis.cancelAnimationFrame = frame => { globalThis.__motionFrames.delete(frame); cancel(frame); };
  });
  await page.route('**/userdata.json*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({...template, ...data}) }));
  await page.route('**/__userdata', async route => { snapshots.push(route.request().postDataJSON()); await route.fulfill({ contentType: 'application/json', body:'{"ok":true}' }); });
  await page.goto('http://127.0.0.1:' + port);
  await page.locator('.motion-tab.motion-idle').waitFor();
}
async function tab(name) {
  await page.locator('nav').getByRole('button', {name, exact:true}).click();
  await page.locator('.motion-tab.motion-idle').waitFor();
}
async function setFixture(value) { await page.evaluate(value => Object.assign(globalThis.__motionFixture, value), value); }
async function screenshot(name) {
  await mkdir(root + '.playwright-mcp', {recursive:true});
  await page.evaluate(() => window.scrollTo({top:0,left:0,behavior:'instant'}));
  await page.screenshot({path:root + '.playwright-mcp/' + name + '.png', fullPage:true, animations:'disabled'});
}

try {
  if (realSdk) {
    await openPage({mobile:process.argv.includes('--mobile')});
    for (const name of ['Chat','Vision','Voice','Notes','Cards','Map','Quiz','Profile','Settings']) {
      await tab(name);
      check(name + ' renders after real SDK initialization', await page.locator('.motion-tab > section').first().isVisible());
    }
    check('real SDK produces no browser runtime errors', errors.length === 0);
    await screenshot(process.argv.includes('--mobile') ? 'real-sdk-settings-mobile' : 'real-sdk-settings');
    console.log(JSON.stringify({passed:checks.length,errors,mode:'real SDK startup; no model weights downloaded'},null,2));
  } else {
  await openPage();
  await page.evaluate(() => {
    document.querySelectorAll('nav button')[4].click();
    document.querySelectorAll('nav button')[5].click();
    document.querySelectorAll('nav button')[8].click();
  });
  await page.locator('.motion-tab.motion-idle .settings-layout').waitFor();
  check('rapid tab changes settle on the latest request', await page.locator('.card-title').first().textContent() === 'Settings');
  await tab('Chat');
  await setFixture({tokenDelay:35, chunkSize:8});
  await page.locator('.chat-input').fill('Explain motion');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.locator('.stream-cursor').waitFor();
  check('single action button becomes Stop during streaming', await page.locator('.send-btn').count() === 1);
  await page.locator('.motion-token').first().waitFor();
  const tokenIdentity = await page.locator('.motion-token').first().getAttribute('data-motion-id');
  const initialDelay = await page.locator('.motion-token').first().evaluate(element => element.style.getPropertyValue('--motion-elapsed'));
  await page.waitForTimeout(150);
  check('earlier token identities survive stream appends', await page.locator('.motion-token').first().getAttribute('data-motion-id') === tokenIdentity);
  check('later tokens do not restart or accelerate an earlier fade', await page.locator('.motion-token').first().evaluate(element => element.style.getPropertyValue('--motion-elapsed')) === initialDelay);
  await page.getByRole('button',{name:'Send message',exact:true}).waitFor();
  check('cursor disappears on completion', await page.locator('.stream-cursor').count() === 0);
  check('streamed Markdown retains bold, links, code and math', await page.locator('.chat-markdown strong').count() === 1 && await page.locator('.chat-markdown a').count() === 1 && await page.locator('.chat-markdown pre code').innerText() === 'const answer = 42;\n' && await page.locator('.chat-markdown .katex').count() === 1);
  await page.getByRole('button',{name:'Regenerate',exact:true}).click();
  await page.locator('.stream-cursor').waitFor();
  await page.getByRole('button',{name:'Send message',exact:true}).waitFor();
  check('regenerate reuses the message bubble', await page.locator('.msg').count() === 2);
  await setFixture({tokenDelay:50,nextText:'Long reply '.repeat(80)});
  await page.locator('.chat-input').fill('Cancel this response');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.locator('.motion-token').last().waitFor();
  await page.getByRole('button',{name:'Stop generation',exact:true}).click();
  check('cancellation removes cursor immediately', await page.locator('.stream-cursor').count() === 0);
  await page.waitForTimeout(150);
  await setFixture({nextText:null,tokenDelay:35});
  await page.locator('.achievement-toast').waitFor();
  await page.locator('.achievement-toast').waitFor({state:'detached'});
  await tab('Profile');
  check('profile XP reflects completion', await page.locator('.profile-xp-fill').getAttribute('style') === 'width: 2%;');
  await screenshot('profile-desktop');

  await tab('Chat');
  const longText = 'A streamed study point. '.repeat(100);
  await setFixture({nextText:longText,tokenDelay:2,chunkSize:8});
  await page.locator('.chat-input').fill('Long stream');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByRole('button',{name:'Stop generation',exact:true}).waitFor();
  await page.getByRole('button',{name:'Send message',exact:true}).waitFor();
  check('long stream preserves the complete text', (await page.locator('.chat-markdown').last().textContent()) === longText.trim());
  await page.waitForTimeout(100);
  check('completed tokens have no running fade animations', await page.locator('.motion-token').evaluateAll(elements => elements.every(element => element.getAnimations().every(animation => animation.playState !== 'running'))));
  await setFixture({nextText:null,tokenDelay:35,chunkSize:8});

  await tab('Notes');
  await page.locator('.notes-editor-shell textarea').fill('Original scratchpad');
  const editorSize = await page.locator('.notes-editor-shell').boundingBox();
  await page.getByRole('button',{name:'Auto-summarize history',exact:true}).click();
  await page.locator('.notes-stream-preview').waitFor();
  check('notes preview preserves editor footprint', Math.abs((await page.locator('.notes-editor-shell').boundingBox()).height - editorSize.height) < 1);
  check('conflicting notes actions disabled', await page.getByRole('button',{name:'Clear notes',exact:true}).isDisabled());
  await page.locator('.motion-note-block').first().waitFor();
  await page.locator('.notes-stream-preview').waitFor({state:'detached'});
  check('notes append commits once and restores editing', (await page.locator('.notes-editor-shell textarea').inputValue()).startsWith('Original scratchpad\n\n# Study notes') && await page.locator('.notes-editor-shell textarea').isEnabled());
  const originalNotes = await page.locator('.notes-editor-shell textarea').inputValue();
  await setFixture({generationError:true});
  await page.getByRole('button',{name:'Replace with summary',exact:true}).click();
  await page.getByRole('alert').waitFor();
  check('notes failure retains original content', await page.locator('.notes-editor-shell textarea').inputValue() === originalNotes);
  await setFixture({generationError:false,tokenDelay:5,chunkSize:100});

  await tab('Cards');
  await page.getByRole('button',{name:'generate cards',exact:true}).click();
  await page.locator('.study-flashcard').waitFor();
  check('deck includes two decorative layers and accessible progress', await page.locator('.deck-stack-layer').count() === 2 && await page.getByRole('progressbar',{name:'Deck position'}).getAttribute('aria-valuemax') === '8');
  await page.locator('.study-flashcard').click();
  check('flip exposes only the answer face', await page.locator('.card-face').getAttribute('aria-hidden') === 'true' && await page.locator('.card-back').getAttribute('aria-hidden') === 'false');
  await page.getByRole('button',{name:'Next flashcard',exact:true}).click();
  check('navigation resets flip and advances progress', await page.locator('.study-flashcard').getAttribute('aria-pressed') === 'false' && await page.getByRole('progressbar',{name:'Deck position'}).getAttribute('aria-valuenow') === '2');
  await page.locator('.study-flashcard').focus();
  await page.locator('.study-flashcard').press('Space');
  check('flashcard supports keyboard activation', await page.locator('.study-flashcard').getAttribute('aria-pressed') === 'true');
  await screenshot('cards-desktop');
  await setFixture({loaderFailure:true});
  await page.getByRole('button',{name:'generate cards',exact:true}).click();
  await page.locator('.deck-generating').waitFor();
  await page.locator('.deck-ready').waitFor();
  check('fallback regeneration restores usable deck', await page.locator('.study-flashcard').isEnabled());
  await setFixture({loaderFailure:false});

  await tab('Map');
  await page.getByRole('button',{name:'Generate concept map',exact:true}).click();
  await page.locator('.mindmap-node').first().waitFor();
  check('map edges use animated masks while retaining dashed leaf styles', await page.locator('mask .motion-map-edge').count() === 5 && await page.locator('.mindmap-canvas > svg > line[stroke-dasharray]').count() > 0);
  await screenshot('map-desktop');

  await tab('Quiz');
  await page.getByRole('button',{name:'Start quiz',exact:true}).click();
  await page.locator('.quiz-opt').first().waitFor();
  for (let index = 0; index < 5; index++) {
    await page.locator('.quiz-opt').nth(index === 1 ? 1 : 0).click();
    check('question ' + (index + 1) + ' locks repeated answers', await page.locator('.quiz-opt').first().isDisabled());
    if (index < 4) await page.getByRole('button',{name:'Next question',exact:true}).click();
  }
  check('final feedback remains before results', await page.locator('.quiz-feedback').count() === 1 && await page.locator('.quiz-result').count() === 0);
  await page.locator('.quiz-result').waitFor();
  check('quiz score remains exact after count animation', (await page.locator('.quiz-result-score').innerText()) === '4/5');
  await page.getByRole('button',{name:'Retry quiz',exact:true}).click();
  for (let index = 0; index < 5; index++) {
    await page.locator('.quiz-opt').first().click();
    if (index < 4) await page.getByRole('button',{name:'Next question',exact:true}).click();
  }
  await page.getByRole('button',{name:'Restart',exact:true}).click();
  await page.waitForTimeout(700);
  check('restart cancels pending final-result transition', await page.locator('.quiz-result').count() === 0 && await page.locator('.quiz-opt').first().isEnabled());

  await tab('Vision');
  await page.locator('input[type=file]').setInputFiles({name:'study.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="yellow"/></svg>')});
  await page.getByRole('button',{name:'Analyze Image',exact:true}).click();
  await page.locator('.vision-analysis-overlay').waitFor();
  await page.locator('.vision-analysis-overlay').waitFor({state:'detached'});
  check('vision overlay clears on successful analysis', (await page.locator('.vision-result-panel').innerText()).includes('Image analysis complete'));
  await setFixture({visionError:true});
  await page.getByRole('button',{name:'Analyze Image',exact:true}).click();
  await page.locator('.is-analyzing').waitFor();
  await page.locator('.is-analyzing').waitFor({state:'detached'});
  check('vision overlay clears on failure', await page.locator('.vision-analysis-overlay').count() === 0);

  await tab('Voice');
  await page.getByRole('button',{name:'Start Listening',exact:true}).click();
  await page.locator('.is-recording').waitFor();
  check('voice shows 11 bars and three recording rings', await page.locator('.wave-bar').count() === 11 && await page.locator('.recording-rings span').count() === 3);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  check('recording decorations stop on manual stop', await page.locator('.recording-rings').count() === 0);
  await setFixture({voiceTurn:true});
  await page.getByRole('button',{name:'Start Listening',exact:true}).click();
  await page.locator('.speaking-dot').waitFor();
  await page.locator('.speaking-dot').waitFor({state:'detached'});
  check('speaking indicator ends with playback', (await page.locator('.voice-status').textContent()) === 'Stopped');
  await tab('Chat');
  await page.waitForTimeout(100);
  check('voice animation frames are cleared after leaving the tab', await page.evaluate(() => !Array.from(globalThis.__motionFrames.values()).includes('sampleEnvelope')));

  for (const theme of ['Classic','Blue','Pink','Orange','Purple']) {
    await tab('Settings');
    await page.getByRole('button',{name:theme,exact:true}).click();
    await tab('Chat');
    check(theme + ' theme retains hard borders and fonts', await page.locator('.card').first().evaluate(element => getComputedStyle(element).borderTopWidth) === '3px');
  }
  await openPage({mobile:true});
  for (const name of ['Chat','Vision','Voice','Notes','Cards','Map','Quiz','Profile','Settings']) {
    await tab(name);
    check(name + ' mobile surface renders', await page.locator('.motion-tab > section').first().isVisible());
  }
  await screenshot('settings-mobile');
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
  const previousDays = [1,2].map(offset => {
    const date = new Date(today + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0,10);
  });
  await openPage({data:{totalStudyEntries:4,totalChatMessages:99,totalXp:990,activityDays:previousDays}});
  check('hydration does not replay saved achievements', await page.locator('.achievement-toast').count() === 0);
  await page.locator('.chat-input').fill('Unlock three achievements');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByRole('button',{name:'Send message',exact:true}).waitFor();
  await tab('Profile');
  check('streak increase creates digit reels after returning to Profile', await page.locator('.streak-digit-strip.is-rolling').count() > 0);
  for (const label of ['5 Sessions','3-Day Streak','1000 XP']) {
    await page.locator('.achievement-toast').getByText(label,{exact:true}).waitFor();
    check(label + ' notification appears in the queue', true);
    await page.locator('.achievement-toast').getByText(label,{exact:true}).waitFor({state:'detached'});
  }
  check('achievement queue drains without moving focus', await page.locator('.achievement-toast').count() === 0 && await page.evaluate(() => document.activeElement.closest('.achievement-toast') === null));
  await openPage({reduced:true,data:{notes:'Source notes'}});
  await tab('Cards');
  await page.getByRole('button',{name:'generate cards',exact:true}).click();
  await page.locator('.study-flashcard').waitFor();
  await page.locator('.study-flashcard').click();
  check('reduced motion keeps functional instant flips', await page.locator('.study-flashcard').getAttribute('aria-pressed') === 'true' && await page.locator('.study-flashcard').evaluate(element => getComputedStyle(element).transitionDuration) === '0s');
  check('reduced motion suppresses decorative animations', await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length) === 0);
  check('reduced motion restores the native cursor', await page.locator('.nb-cursor-trail').count() === 0 && await page.locator('body').evaluate(element => getComputedStyle(element).cursor) === 'auto');
  for (const name of ['Chat','Vision','Voice','Notes','Cards','Map','Quiz','Profile','Settings']) await tab(name);
  check('all tabs remain navigable with reduced motion', await page.locator('.settings-layout').isVisible());
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => document.querySelectorAll('nav button')[0].click());
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.motion-tab.motion-idle .chat-input').waitFor();
  check('changing motion preference during navigation cannot strand a tab', await page.locator('.motion-tab[inert]').count() === 0);
  await screenshot('cards-reduced');
  await page.waitForTimeout(900);
  check('persistence snapshots retain the original data schema', snapshots.length > 0 && snapshots.every(snapshot => !('achievementQueue' in snapshot) && !('initialMotionValues' in snapshot)));
  check('no browser runtime errors', errors.length === 0);
  console.log(JSON.stringify({passed:checks.length,errors,screenshots:'.playwright-mcp/'},null,2));
  }
} catch (error) {
  console.log('Browser errors:', errors);
  await screenshot('failure');
  throw error;
} finally {
  await browser.close();
  await server.close();
}
