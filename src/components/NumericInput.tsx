import { useEffect, useRef, useState } from 'react'

type NumericInputProps = {
  value: number | null | undefined
  onValueChange: (value: number) => void
  onEmpty?: () => void
  min?: number
  max?: number
  step?: number
  inputMode?: 'numeric' | 'decimal'
  [key: string]: any
}

function displayValue(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '' : String(value)
}

function clamp(value: number, min?: number, max?: number) {
  let next = value
  if (min != null) next = Math.max(min, next)
  if (max != null) next = Math.min(max, next)
  return next
}

/**
 * A mobile-friendly controlled number input.
 *
 * Parent state stays numeric, while the input keeps a temporary string draft so
 * the user can clear the field before typing a replacement. Focusing selects the
 * current value, which lets a new digit replace defaults such as 0, 1 or 30 in
 * one tap instead of appending to them.
 */
export function NumericInput({
  value,
  onValueChange,
  onEmpty,
  min,
  max,
  step,
  inputMode = 'numeric',
  onFocus,
  onBlur,
  ...rest
}: NumericInputProps) {
  const [draft, setDraft] = useState(() => displayValue(value))
  const focused = useRef(false)
  const latestValue = useRef(value)
  latestValue.current = value

  useEffect(() => {
    if (!focused.current) setDraft(displayValue(value))
  }, [value])

  const restoreCurrent = () => setDraft(displayValue(latestValue.current))

  return <input
    {...rest}
    type="number"
    inputMode={inputMode}
    min={min}
    max={max}
    step={step}
    value={draft}
    onFocus={(event: any) => {
      focused.current = true
      onFocus?.(event)
      const input = event.currentTarget
      window.requestAnimationFrame(() => input.select())
    }}
    onChange={(event: any) => {
      const raw = event.target.value
      setDraft(raw)
      if (raw.trim() === '') return
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) return
      if (min != null && parsed < min) return
      if (max != null && parsed > max) return
      onValueChange(parsed)
    }}
    onBlur={(event: any) => {
      focused.current = false
      const raw = draft.trim()
      if (raw === '') {
        if (onEmpty) onEmpty()
        else restoreCurrent()
      } else {
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) restoreCurrent()
        else {
          const normalized = clamp(parsed, min, max)
          onValueChange(normalized)
          setDraft(String(normalized))
        }
      }
      onBlur?.(event)
    }}
  />
}
