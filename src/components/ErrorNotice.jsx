import React, {useState} from 'react';
import {AlertCircle, Check, Copy, RefreshCw, WifiOff, X} from 'lucide-react';
import {describeError, formatErrorDetails} from '../lib/errors.js';

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export function ErrorNotice({
  error,
  context = '',
  title = '',
  compact = false,
  className = '',
  id = undefined,
  onRetry = null,
  retryLabel = 'Try again',
  onDismiss = null,
  dismissLabel = 'Dismiss error',
  children = null,
}) {
  const [copyState, setCopyState] = useState('');
  if (!error) return null;
  const info = describeError(error, {context, title});
  const retry = onRetry || error?.onRetry || info.onRetry || null;
  const Icon = info.kind === 'offline' ? WifiOff : AlertCircle;
  const detailsText = formatErrorDetails(info, {context});

  const copyDetails = async () => {
    try {
      await copyText(detailsText);
      setCopyState('Copied');
    } catch {
      setCopyState('Copy failed');
    }
  };

  return <section
    id={id}
    className={`app-error-notice ${info.severity || 'error'} ${compact ? 'compact' : ''} ${className}`.trim()}
    role="alert"
    aria-live="assertive"
  >
    <span className="app-error-icon"><Icon size={20}/></span>
    <div className="app-error-body">
      <div className="app-error-head">
        <strong>{info.title}</strong>
        {info.code && <span className="app-error-code">Code: {info.code}</span>}
      </div>
      <p><b>What happened:</b> <span>{info.message}</span></p>
      <p><b>Possible solution:</b> <span>{info.solution}</span></p>
      {children}
      <details className="app-error-details">
        <summary>Technical details for support</summary>
        <pre>{info.technical || info.originalMessage || info.message}</pre>
        <button type="button" className="secondary-button app-error-copy" onClick={copyDetails}>
          {copyState === 'Copied' ? <Check size={14}/> : <Copy size={14}/>} {copyState || 'Copy error details'}
        </button>
      </details>
      {(retry || onDismiss) && <div className="app-error-actions">
        {retry && <button type="button" className="secondary-button" onClick={retry}><RefreshCw size={14}/> {retryLabel}</button>}
        {onDismiss && <button type="button" className="secondary-button" onClick={onDismiss}><X size={14}/> Dismiss</button>}
      </div>}
    </div>
    {onDismiss && <button type="button" className="icon-button app-error-close" aria-label={dismissLabel} onClick={onDismiss}><X size={16}/></button>}
  </section>;
}

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {error: null};
  }

  static getDerivedStateFromError(error) {
    return {error};
  }

  componentDidCatch(error, info) {
    // Keep the browser console useful for support without sending private ERP
    // records anywhere. The on-screen notice gives the user a safe next step.
    console.error('Yoga Studio UI error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="app-error-boundary">
      <div className="app-error-boundary-card">
        <p className="eyebrow">YOGA STUDIO</p>
        <h1>Something interrupted this screen.</h1>
        <p>Your saved studio data was not intentionally changed by this display error. Try returning to the screen, or reload the app if the problem repeats.</p>
        <ErrorNotice error={this.state.error} context="Open this screen"/>
        <div className="app-error-boundary-actions">
          <button type="button" className="secondary-button" onClick={() => this.setState({error: null})}>Try this screen again</button>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>Reload app</button>
        </div>
      </div>
    </main>;
  }
}
