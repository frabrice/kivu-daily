import { Component, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

// One page failing must never blank the whole app: show what happened
// and keep the shell (menus, tabs, search) working.
export default class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Page error', error); }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
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
