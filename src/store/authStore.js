import { create } from 'zustand'
import * as vendorApi from '../services/vendor'
import { hasAuthToken } from '../services/api'

/**
 * Session state. `status` is deliberately three-valued: 'unknown' means we have
 * not yet asked the bench whether the cookie is still good, and the router must
 * wait rather than bouncing a logged-in vendor to /login on every refresh.
 */
export const useAuthStore = create((set) => ({
  status: 'unknown', // 'unknown' | 'authenticated' | 'guest'
  user: null,
  vendorProfile: null,

  async rehydrate() {
    try {
      const session = await vendorApi.getSession()
      set({
        status: 'authenticated',
        user: session.user,
        vendorProfile: session.vendor_profile,
      })
    } catch {
      set({ status: 'guest', user: null, vendorProfile: null })
    }
  },

  /**
   * Sign in.
   *
   * Returns `{otpRequired: true, email}` when the account exists but has not
   * verified its email — same contract as `register`. The store must NOT move
   * to 'authenticated' for it, and must not do so for any response that came
   * back without a usable token either: "authenticated" is a claim about
   * having credentials, and making it without them produces a portal that
   * looks signed in and fails every request.
   */
  async login(email, password) {
    const session = await vendorApi.login(email, password)
    if (session?.otpRequired) return session
    if (!hasAuthToken()) {
      throw new Error('We couldn’t sign you in. Please try again.')
    }
    set({
      status: 'authenticated',
      user: session.user,
      vendorProfile: session.vendor_profile,
    })
    return session
  },

  /**
   * The same landing as `login`, from a Google ID token instead of a password.
   *
   * Deliberately shares the token check and the `otpRequired` branch rather
   * than reimplementing them: the bug those exist for — a partner sent to a
   * dashboard with nothing to authenticate with — does not care which button
   * they pressed to get there.
   */
  async loginWithGoogle(credential) {
    const session = await vendorApi.loginWithGoogle(credential)
    if (session?.otpRequired) return session
    if (!hasAuthToken()) {
      throw new Error('We couldn’t sign you in. Please try again.')
    }
    set({
      status: 'authenticated',
      user: session.user,
      vendorProfile: session.vendor_profile,
    })
    return session
  },

  /**
   * Register.
   *
   * Returns `{otpRequired: true, email}` when the bench requires email
   * verification. The store must NOT move to 'authenticated' in that case: the
   * account exists but is disabled, so dropping it into the portal would mean
   * every authenticated call failing behind a UI that looks signed in.
   *
   * Returns a session as before when verification is not deployed.
   */
  async register(payload) {
    const session = await vendorApi.register(payload)
    if (session?.otpRequired) return session

    set({
      status: 'authenticated',
      user: session.user,
      vendorProfile: session.vendor_profile,
    })
    return session
  },

  async verifyEmail(email, code) {
    const session = await vendorApi.verifyOtp(email, code)
    set({
      status: 'authenticated',
      user: session.user ?? email,
      vendorProfile: session.vendor_profile ?? null,
    })
    return session
  },

  async resetPassword(email, code, newPassword) {
    const session = await vendorApi.resetPassword(email, code, newPassword)
    set({
      status: 'authenticated',
      user: session.user ?? email,
      vendorProfile: session.vendor_profile ?? null,
    })
    return session
  },

  async logout() {
    try {
      await vendorApi.logout()
    } finally {
      set({ status: 'guest', user: null, vendorProfile: null })
    }
  },

  setProfile: (vendorProfile) => set({ vendorProfile }),
  clear: () => set({ status: 'guest', user: null, vendorProfile: null }),
}))

// The axios interceptor fires this when the bench rejects the session.
window.addEventListener('shotright:session-expired', () => {
  useAuthStore.getState().clear()
})
