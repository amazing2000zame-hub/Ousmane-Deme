import { useState, type FormEvent } from 'react';
import { Toaster, toast } from 'sonner';
import { useAuthStore } from './stores/auth';
import { useClusterSocket } from './hooks/useClusterSocket';
import { useEventsSocket } from './hooks/useEventsSocket';
import { login } from './services/api';
import { Dashboard } from './components/layout/Dashboard';

function LoginForm() {
  const setToken = useAuthStore((s) => s.setToken);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const token = await login(password);
      setToken(token);
      toast.success('Authenticated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      setError(msg);
      toast.error('Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full bg-jarvis-bg flex items-center justify-center">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm p-8 bg-jarvis-bg-panel border border-jarvis-amber/30 rounded-lg"
      >
        <h1 className="font-display text-2xl text-jarvis-amber tracking-[0.2em] text-center mb-8">
          J.A.R.V.I.S.
        </h1>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-[10px] font-display text-jarvis-amber-dim uppercase tracking-wider mb-2"
            >
              ACCESS CODE
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              className="w-full bg-jarvis-bg-card border border-jarvis-amber/20 rounded px-3 py-2 text-sm font-mono text-jarvis-text placeholder:text-jarvis-text-muted focus:outline-none focus:border-jarvis-amber/50 focus:ring-1 focus:ring-jarvis-amber/20 transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-jarvis-red font-mono">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="w-full py-2 bg-jarvis-amber/10 border border-jarvis-amber/30 text-jarvis-amber font-display text-sm uppercase tracking-wider rounded hover:bg-jarvis-amber/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'AUTHENTICATING...' : 'AUTHENTICATE'}
          </button>
        </div>
      </form>
    </div>
  );
}

function AuthenticatedApp() {
  // Establish Socket.IO connections at the app level
  useClusterSocket();
  useEventsSocket();

  return <Dashboard />;
}

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <>
      {isAuthenticated ? <AuthenticatedApp /> : <LoginForm />}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#0d0d14',
            border: '1px solid rgba(255, 184, 0, 0.2)',
            color: '#e8e0d0',
          },
        }}
      />
    </>
  );
}

export default App;
