import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../App'
import { setAuthToken } from '../services/api'
import { useAuthStore } from '../store/authStore'

/**
 * Mount the REAL app, at a route, and drive it like a person.
 *
 * Not a component under test with props supplied by hand. Every one of these
 * suites goes through the same code a partner does: the router, the query
 * client, the auth guard, the service layer, the axios interceptors. The only
 * substitution is the bench itself, at the network boundary.
 *
 * That is deliberate and it costs something — the tests are slower and a
 * failure can come from anywhere in the stack. It buys the only thing worth
 * having here: a passing test means the flow actually works, rather than
 * meaning a component renders when handed data no real screen would produce.
 * Nearly every bug on this project has lived in the seams between those pieces.
 */
export function renderApp({ route = '/', signedIn = false } = {}) {
  if (signedIn) {
    setAuthToken({ api_key: 'KEY', api_secret: 'SECRET' })
  } else {
    setAuthToken(null)
  }

  // Zustand is a module singleton and survives between tests in a file. Reset
  // it, or the second test in a file starts already logged in as whoever the
  // first one was.
  useAuthStore.setState({ status: 'unknown', user: null, vendorProfile: null })

  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // a retry turns one 404 into a four-second test
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })

  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return {
    ...view,
    // `advanceTimers` is unset on purpose: these suites use real timers, since
    // the code under test debounces autosave and polls import status, and fake
    // timers plus MSW is a reliable way to produce a hang nobody can debug.
    user: userEvent.setup(),
  }
}

/** Sign in through the form, because logging in IS one of the flows. */
export async function signIn(user, screen, { email = 'thabo@cornerkitchen.co.za', password = 'correct-horse' } = {}) {
  await user.type(screen.getByLabelText(/email/i), email)
  await user.type(screen.getByLabelText(/password/i), password)
  await user.click(screen.getByRole('button', { name: /login|sign in/i }))
}
