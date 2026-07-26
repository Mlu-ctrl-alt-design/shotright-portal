import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export default function ProtectedRoute() {
  const status = useAuthStore((s) => s.status)
  const location = useLocation()

  if (status !== 'authenticated') {
    // Remember where they were headed so login can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
