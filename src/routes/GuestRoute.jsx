import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

/** Keeps an already-authenticated vendor off /login and /register. */
export default function GuestRoute() {
  const status = useAuthStore((s) => s.status)
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}
