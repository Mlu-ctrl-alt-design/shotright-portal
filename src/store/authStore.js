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

  async register(payload) {
    const session = await vendorApi.register(payload)
    set({
      status: 'authenticated',
      user: session.user,
      vendorProfile: session.vendor_profile,
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
