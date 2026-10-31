import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { isChunkError, reloadOnce } from '../lib/chunkReload';

// One page failing must never blank the whole app: show what happened
// and keep the shell (menus, tabs, search) working.
export default class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; reloading: boolean }> {
  state = { error: null as Error | null, reloading: false };
  static getDerivedStateFromError(error: Error) { return { error }; }
  // A page file from before the last deploy: load the new version by itself
  // (once - if it still fails after that, say what failed instead).
  componentDidCatch(error: Error) { console.error('Page error', error); if (isChunkError(error)) this.setState({ reloading: reloadOnce() }); }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null, reloading: false }); }
  render() {
    if (!this.state.error) return this.props.children;
    if (isChunkError(this.state.error) && this.state.reloading) return (
      <div className="max-w-lg mx-auto mt-12 card p-6 text-center">
        <RefreshCw size={24} className="mx-auto text-accent-fg mb-2 animate-spin" />
        <p className="text-title font-semibold">Kivu Daily was just updated</p>
        <p className="text-body text-fg-muted mt-1">Loading the new version…</p>
      </div>
    );
    if (isChunkError(this.state.error)) return (
      <div className="max-w-lg mx-auto mt-12 card p-6 text-center">
        <AlertTriangle size={26} className="mx-auto text-attention mb-2" />
        <p className="text-title font-semibold">Part of this page couldn't load</p>
        <p className="text-body text-fg-muted mt-1">Reloading didn't fix it. Press <b>Ctrl + Shift + R</b>. If it still shows, turn off ad or privacy blockers for Kivu Daily, or send IT a screenshot of this box.</p>
        <p className="text-caption font-mono text-fg-subtle mt-3 break-all">{this.state.error.message}</p>
        <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => this.setState({ error: null, reloading: false })} className="btn-secondary"><RotateCcw size={14} /> Try again</button>
          <button onClick={() => window.location.reload()} className="btn-primary"><RefreshCw size={14} /> Reload</button>
        </div>
      </div>
    );
    return (
      <div className="max-w-lg mx-auto mt-12 card p-6 text-center">
        <AlertTriangle size={26} className="mx-auto text-attention mb-2" />
        <p className="text-title font-semibold">This page hit a problem</p>
        <p className="text-body text-fg-muted mt-1">The rest of Kivu Daily still works. Try again, and if it keeps happening, flag it to IT.</p>
        <p className="text-caption font-mono text-fg-subtle mt-3 break-all">{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })} className="btn-primary mt-4"><RotateCcw size={14} /> Try again</button>
      </div>
    );
  }
}
