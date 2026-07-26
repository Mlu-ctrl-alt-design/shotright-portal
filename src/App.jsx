import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import GuestRoute from './routes/GuestRoute'
import ProtectedRoute from './routes/ProtectedRoute'
import Shell from './components/layout/Shell'
import Spinner from './components/ui/Spinner'

import Login from './views/guest/Login'
import Register from './views/guest/Register'
import Dashboard from './views/vendor/Dashboard'
import VenueList from './views/vendor/VenueList'
import VenueForm from './views/vendor/VenueForm'
import VenueWizard from './views/vendor/wizard/VenueWizard'
import VenueMenu from './views/vendor/VenueMenu'
import Profile from './views/vendor/Profile'

export default function App() {
  const rehydrate = useAuthStore((s) => s.rehydrate)
  const status = useAuthStore((s) => s.status)

  // On a hard refresh the Zustand store is empty but the Frappe session cookie
  // may still be valid — ask the bench who we are before deciding to redirect.
  useEffect(() => {
    rehydrate()
  }, [rehydrate])

  if (status === 'unknown') {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Restoring session…" />
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/venues" element={<VenueList />} />
          {/* The designs route "Add New" into the five-step wizard. VenueForm
              stays behind the edit route until the wizard can also edit. */}
          <Route path="/venues/new" element={<VenueWizard />} />
          <Route
            path="/venues/declined"
            element={<VenueList status="Rejected" heading="Declined venues" />}
          />
          <Route
            path="/venues/pending"
            element={<VenueList status="Pending" heading="Pending venues" />}
          />
          <Route path="/venues/:venueId/edit" element={<VenueForm />} />
          <Route path="/venues/:venueId/menu" element={<VenueMenu />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
