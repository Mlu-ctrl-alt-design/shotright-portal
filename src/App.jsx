import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import GuestRoute from './routes/GuestRoute'
import ProtectedRoute from './routes/ProtectedRoute'
import Shell from './components/layout/Shell'
import AuthLayout from './components/layout/AuthLayout'
import Spinner from './components/ui/Spinner'

/**
 * Every view is code-split. Before this, one 550 kB chunk carried the entire
 * app — the login page was downloading the wizard, the map, the menu editor
 * and every venue screen before it could paint, which on the mobile networks
 * partners actually use is most of the "the app takes a while" complaint.
 * Splitting per view means the first paint needs the shell libraries and one
 * screen; the rest arrives when (and if) it is asked for. Vite turns each of
 * these into its own fetchable chunk with no further configuration.
 */
const Login = lazy(() => import('./views/guest/Login'))
const Register = lazy(() => import('./views/guest/Register'))
const VerifyEmail = lazy(() => import('./views/guest/VerifyEmail'))
const ForgotPassword = lazy(() => import('./views/guest/ForgotPassword'))
const Dashboard = lazy(() => import('./views/vendor/Dashboard'))
const VenueList = lazy(() => import('./views/vendor/VenueList'))
const VenueForm = lazy(() => import('./views/vendor/VenueForm'))
const VenueWizard = lazy(() => import('./views/vendor/wizard/VenueWizard'))
const VenueMenu = lazy(() => import('./views/vendor/VenueMenu'))
const VenueReview = lazy(() => import('./views/vendor/VenueReview'))
const VenuePreview = lazy(() => import('./views/vendor/VenuePreview'))
const VenueLayout = lazy(() => import('./views/vendor/VenueLayout'))
const VenueOverview = lazy(() => import('./views/vendor/VenueOverview'))
const VenueBookings = lazy(() => import('./views/vendor/VenueBookings'))
const VenueRatings = lazy(() => import('./views/vendor/VenueRatings'))
const VenuePromote = lazy(() => import('./views/vendor/VenuePromote'))
const Profile = lazy(() => import('./views/vendor/Profile'))
const Messages = lazy(() => import('./views/vendor/Messages'))
const Legal = lazy(() => import('./views/vendor/Legal'))
const VenueBulkImport = lazy(() => import('./views/vendor/VenueBulkImport'))
const ClaimSearch = lazy(() => import('./views/vendor/ClaimSearch'))
const ClaimHandoff = lazy(() => import('./views/claim/ClaimHandoff'))

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
    /* The fallback matches the session-restore state above, so a slow chunk
       and a slow session read look like one continuous loading state rather
       than two different screens flashing past. */
    <Suspense
      fallback={
        <div className="grid h-full place-items-center">
          <Spinner label="Loading…" />
        </div>
      }
    >
      <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        {/* Only reachable when the bench reports otp_required; see Register.jsx. */}
        <Route path="/verify" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          {/* One list, filtered by ?status=. Approval state is a state OF a
              venue, not a place in the app — see VenueList.jsx. */}
          <Route path="/venues" element={<VenueList />} />
          {/* The designs route "Add New" into the five-step wizard. VenueForm
              stays behind the edit route until the wizard can also edit. */}
          <Route path="/venues/new" element={<VenueWizard />} />
          <Route path="/venues/import" element={<VenueBulkImport />} />
          {/* Kept as redirects rather than deleted. These were real pages, so
              they are in partners' history and bookmarks; letting them fall
              through to the catch-all would silently dump someone on the
              dashboard, which nobody would think to report as a bug. */}
          <Route
            path="/venues/declined"
            element={<Navigate to="/venues?status=declined" replace />}
          />
          <Route
            path="/venues/pending"
            element={<Navigate to="/venues?status=pending" replace />}
          />
          {/* One venue, one place. A LAYOUT rather than a new page, so every
              existing URL keeps working and simply gains the tab bar — no
              bookmark breaks and nothing the wizard or the decline screen
              navigates to has to change. */}
          <Route path="/venues/:venueId" element={<VenueLayout />}>
            <Route index element={<VenueOverview />} />
            <Route path="edit" element={<VenueForm />} />
            <Route path="menu" element={<VenueMenu />} />
            <Route path="bookings" element={<VenueBookings />} />
            <Route path="ratings" element={<VenueRatings />} />
            <Route path="promote" element={<VenuePromote />} />
            <Route path="preview" element={<VenuePreview />} />
          </Route>
          {/* A decline is a decision made ABOUT a venue, so it lives on the
              venue rather than in a notifications pile — it is still there in
              a week, when the partner finally has an hour to deal with it. */}
          <Route path="/venues/:venueId/review" element={<VenueReview />} />
          {/* Finding a venue that is already in the catalogue, instead of
              adding a duplicate of it. Starts a claim and hands over to
              /claim/:token below. */}
          <Route path="/claim" element={<ClaimSearch />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/profile" element={<Profile />} />
          {/* Reachable from the banner, from Settings, and from a blocked
              submit. Always reachable — a partner must be able to re-read what
              they agreed to without having to ask us for a copy. */}
          <Route path="/legal" element={<Legal />} />
        </Route>
      </Route>

        {/* The one page OUTSIDE both guards. The customer app opens it for
            somebody who may have no partner account yet, and the token in the
            URL is the authorisation, so a guest must be able to read it — but
            a signed-in partner should see it in their portal, not in the
            sign-in chrome. Same page, two frames. */}
        <Route
          path="/claim/:token"
          element={status === 'authenticated' ? <Shell /> : <GuestFrame />}
        >
          <Route index element={<ClaimHandoff />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

function GuestFrame() {
  return (
    <AuthLayout wide>
      <Outlet />
    </AuthLayout>
  )
}
