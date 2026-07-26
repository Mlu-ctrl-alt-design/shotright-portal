import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as vendorApi from '../services/vendor'

/* --------------------------------------------------------------- dashboard */

export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: vendorApi.getDashboard })

/* ------------------------------------------------------------------ moods */

// Canonical list is Desk-managed — safe to cache hard.
export const useMoods = () =>
  useQuery({ queryKey: ['moods'], queryFn: vendorApi.getMoods, staleTime: 5 * 60 * 1000 })

/* ---------------------------------------------------------------- lookups */

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

export const useUpdateVenue = (venueId) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload) => vendorApi.updateVenue(venueId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] })
      qc.invalidateQueries({ queryKey: ['venue', venueId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
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
