import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as vendorApi from '../services/vendor'

/* --------------------------------------------------------------- dashboard */

export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: vendorApi.getDashboard })

/* ------------------------------------------------------------------ moods */

// Canonical list is Desk-managed — safe to cache hard.
export const useMoods = () =>
  useQuery({ queryKey: ['moods'], queryFn: vendorApi.getMoods, staleTime: 5 * 60 * 1000 })

// What other approved venues actually chose, for the onboarding smart default.
// An aggregate over every venue on the platform changes slowly by nature, so it
// is cached harder than the list it draws from.
export const usePopularMoods = (limit = 8) =>
  useQuery({
    queryKey: ['moods', 'popular', limit],
    queryFn: () => vendorApi.getPopularMoods(limit),
    staleTime: 30 * 60 * 1000,
  })

/* ---------------------------------------------------------------- lookups */

/**
 * Aggregate popularity for the venue dropdowns (smart defaults, Tier C).
 *
 * Refreshed nightly server-side, so a long stale time is right — and the query
 * must never gate form render, per spec §9: "Never block form render on the
 * popularity call."
 */
export const usePopularVenueOptions = () =>
  useQuery({
    queryKey: ['venue-options', 'popular'],
    queryFn: vendorApi.getPopularVenueOptions,
    staleTime: 60 * 60 * 1000,
    retry: false,
  })

// Dress codes and atmospheres, also Desk-managed — cache just as hard.
export const useVenueLookups = () =>
  useQuery({
    queryKey: ['venue-lookups'],
    queryFn: vendorApi.getVenueLookups,
    staleTime: 5 * 60 * 1000,
  })

/* ----------------------------------------------------------------- venues */

export const useVenues = () =>
  useQuery({ queryKey: ['venues'], queryFn: vendorApi.getVenues })

export const useVenue = (venueId) =>
  useQuery({
    queryKey: ['venue', venueId],
    queryFn: () => vendorApi.getVenue(venueId),
    enabled: !!venueId,
  })

export const useCreateVenue = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: vendorApi.createVenue,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/**
 * `currentName` is the venue's name as the server holds it — NOT `venueId`,
 * which is its docname and may be `VEN-0001`. The service needs both to tell a
 * rename apart from an ordinary save; see `updateVenue`.
 */
export const useUpdateVenue = (venueId, existing) => {
  const qc = useQueryClient()
  return useMutation({
    // `existing` is the venue as the server holds it. The service needs the
    // whole record, not just its name: it diffs against it so a save carries
    // only what the partner actually changed.
    mutationFn: (payload) => vendorApi.updateVenue(venueId, payload, existing),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] })
      qc.invalidateQueries({ queryKey: ['venue', venueId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/* ----------------------------------------------------------- venue photos */

/**
 * Whether the bench can hold venue photos at all.
 *
 * One probe per tab, cached forever — deploying an endpoint mid-session is not
 * a case worth refetching for, and the answer decides what the uploader
 * PROMISES. Getting it wrong in the optimistic direction means telling a
 * partner their photos are live when they are sitting in a File table.
 */
export const useVenuePhotoSupport = () =>
  useQuery({
    queryKey: ['venue-photos', 'supported'],
    queryFn: vendorApi.venuePhotosSupported,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })

export const useVenuePhotos = (venueId) =>
  useQuery({
    queryKey: ['venue-photos', venueId],
    queryFn: () => vendorApi.getVenuePhotos(venueId),
    enabled: !!venueId,
  })

export const useSaveVenuePhotos = (venueId) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (photos) => vendorApi.saveVenuePhotos(venueId, photos),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['venue-photos', venueId] }),
  })
}

/* ------------------------------------------------------------------- menu */

export const useMenu = (venueId) =>
  useQuery({
    queryKey: ['menu', venueId],
    queryFn: () => vendorApi.getMenu(venueId),
    enabled: !!venueId,
  })

const invalidateMenu = (qc, venueId) => () =>
  qc.invalidateQueries({ queryKey: ['menu', venueId] })

export const useCreateHeading = (venueId) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (heading) => vendorApi.createHeading(venueId, heading),
    onSuccess: invalidateMenu(qc, venueId),
  })
}

export const useCreateItem = (venueId) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ headingId, ...payload }) => vendorApi.createItem(headingId, payload),
    onSuccess: invalidateMenu(qc, venueId),
  })
}

export const useUpdateItem = (venueId) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, ...payload }) => vendorApi.updateItem(itemId, payload),
    onSuccess: invalidateMenu(qc, venueId),
  })
}

export const useDeleteItem = (venueId) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: vendorApi.deleteItem,
    onSuccess: invalidateMenu(qc, venueId),
  })
}

export const useImportMenu = (venueId) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rows) => vendorApi.importMenu(venueId, rows),
    onSuccess: invalidateMenu(qc, venueId),
  })
}

/* ---------------------------------------------------------------- profile */

export const useProfile = () =>
  useQuery({ queryKey: ['profile'], queryFn: vendorApi.getProfile })

export const useUpdateProfile = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: vendorApi.updateProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
