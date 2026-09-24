import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--bg)',
          color: 'var(--text)'
        }}>
          <div style={{
            background: 'var(--surface)',
            padding: '32px',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
            maxWidth: '600px',
            width: '100%',
            border: '1px solid var(--danger-border)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--danger)', marginBottom: '16px' }}>
              <AlertTriangle size={32} />
              <h2 style={{ margin: 0, fontSize: '20px' }}>Произошла непредвиденная ошибка интерфейса</h2>
            </div>
            
            <p style={{ marginBottom: '16px', lineHeight: 1.5 }}>
              Извините, что-то сломалось на этой странице. Это ошибка на стороне приложения (фронтенда).
            </p>
            
            <div style={{ 
              background: 'var(--danger-bg)', 
              padding: '12px', 
              borderRadius: 'var(--radius-md)', 
              marginBottom: '24px',
              fontFamily: 'monospace',
              fontSize: '13px',
              color: 'var(--danger-text)',
              overflowX: 'auto'
            }}>
              <strong>{this.state.error && this.state.error.toString()}</strong>
              <br/>
              <span style={{ opacity: 0.8, whiteSpace: 'pre-wrap' }}>
                {import.meta.env.MODE === "development" && this.state.errorInfo && this.state.errorInfo.componentStack}
              </span>
            </div>

            <button 
              className="btn primary wide"
              onClick={() => window.location.reload()}
              style={{ display: 'flex', justifyContent: 'center' }}
            >
              <RefreshCw size={16} /> Перезагрузить страницу
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

