import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles/global.css';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './auth/AuthProvider';
import { ConfirmProvider } from './components/ConfirmDialog';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
