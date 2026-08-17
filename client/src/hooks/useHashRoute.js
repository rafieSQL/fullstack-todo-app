import { useState, useEffect, useCallback } from 'react'

const VALID_ROUTES = ['home', 'main', 'focus', 'calendar']

/**
 * Normalizes window.location.hash into a standard route name
 * @param {string} hash
 * @param {boolean} isAuthenticated
 * @returns {'home' | 'main' | 'focus' | 'calendar'}
 */
export function getRouteFromHash(hash, isAuthenticated = false) {
  const cleaned = (hash || '').replace(/^#\/?/, '').toLowerCase().trim()

  if (cleaned === 'main' || cleaned === 'tasks') return 'main'
  if (cleaned === 'calendar') return 'calendar'
  if (cleaned === 'focus') return 'focus'
  if (cleaned === 'home' || cleaned === 'landing') return 'home'

  // Default fallback based on authentication status
  return isAuthenticated ? 'main' : 'home'
}

/**
 * Custom hook for managing application hash routing and browser history
 */
export function useHashRoute(session, isDemoMode) {
  const isAuthOrDemo = Boolean(session || isDemoMode)

  const [currentRoute, setCurrentRoute] = useState(() => {
    return getRouteFromHash(window.location.hash, isAuthOrDemo)
  })

  const [previousRoute, setPreviousRoute] = useState(() => {
    const initial = getRouteFromHash(window.location.hash, isAuthOrDemo)
    return initial !== 'focus' ? initial : 'main'
  })

  // Synchronize hash with state and listen to browser Back/Forward navigation
  useEffect(() => {
    const handleHashChange = () => {
      const newRoute = getRouteFromHash(window.location.hash, isAuthOrDemo)
      setCurrentRoute((prev) => {
        if (prev !== 'focus' && newRoute === 'focus') {
          setPreviousRoute(prev)
        }
        return newRoute
      })
    }

    // Initial check & ensure hash exists
    if (!window.location.hash) {
      const initial = isAuthOrDemo ? 'main' : 'home'
      window.location.hash = `#${initial}`
    } else {
      handleHashChange()
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [isAuthOrDemo])

  // Navigation function to update hash seamlessly
  const navigate = useCallback((targetRoute) => {
    if (!VALID_ROUTES.includes(targetRoute)) return
    if (window.location.hash !== `#${targetRoute}`) {
      window.location.hash = `#${targetRoute}`
    }
  }, [])

  // Helper to exit focus mode back to previous workspace view (#main or #calendar)
  const exitFocusRoute = useCallback(() => {
    const fallback = previousRoute === 'calendar' ? 'calendar' : 'main'
    navigate(fallback)
  }, [previousRoute, navigate])

  return {
    currentRoute,
    previousRoute,
    navigate,
    exitFocusRoute,
    isHome: currentRoute === 'home',
    isMain: currentRoute === 'main',
    isFocus: currentRoute === 'focus',
    isCalendar: currentRoute === 'calendar'
  }
}
