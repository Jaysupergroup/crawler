import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

// An unexpected saved record must never leave the entire dashboard blank.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CrawlLoom dashboard rendering error', error, info);
  }

  render() {
    if (this.state.error) {
      return <main><section className="card app-recovery" role="alert">
        <p className="eyebrow">Dashboard recovery</p>
        <h1>This audit could not be displayed safely.</h1>
        <p>The saved crawl has not been deleted. Reload the dashboard to try again.</p>
        <button className="primary" onClick={() => window.location.reload()}>Reload dashboard</button>
      </section></main>;
    }
    return this.props.children;
  }
}
