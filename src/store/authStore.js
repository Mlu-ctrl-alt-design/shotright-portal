import { create } from 'zustand'
import * as vendorApi from '../services/vendor'

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

  async login(email, password) {
    const session = await vendorApi.login(email, password)
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
