import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export default function ProtectedRoute() {
  const status = useAuthStore((s) => s.status)
  const location = useLocation()

  if (status !== 'authenticated') {
    // Remember where they were headed so login can return them there.
    // The query string travels too: Payfast returns here with
    // `?payment=success&attempt=…`, and a partner whose session lapsed while
    // paying must still hear about it after signing back in.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}
