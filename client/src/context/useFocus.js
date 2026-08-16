import { useContext } from 'react'
import { FocusContext } from './FocusContextInstance.js'

export function useFocus() {
  const context = useContext(FocusContext)
  if (!context) {
    throw new Error('useFocus must be used within a FocusProvider')
  }
  return context
}
