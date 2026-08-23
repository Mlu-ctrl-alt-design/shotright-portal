import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { registerSessionSeeder } from './services/vendor'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

// The session restore fetches the dashboard to learn who is signed in; hand
// that payload straight to the cache so the first screen doesn't fetch the
// identical thing again. Registered here — the composition root is the one
// place that has both the service layer and this client.
registerSessionSeeder((dash) => queryClient.setQueryData(['dashboard'], dash))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
