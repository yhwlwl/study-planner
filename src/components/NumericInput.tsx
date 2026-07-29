import { useEffect, useRef, useState } from 'react'

type NumericInputProps = {
  value: number | null | undefined
  onValueChange: (value: number) => void
  onEmpty?: () => void
  min?: number
  max?: number
  step?: number
  inputMode?: 'numeric' | 'decimal'
  commitMode?: 'change' | 'blur'
  allowNegative?: boolean
  allowDecimal?: boolean
  [key: string]: any
}

function displayValue(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '' : String(value)
}

function normalizeDigits(value: string) {
  return value.replace(/[０-９]/g, character => String(character.charCodeAt(0) - 0xfee0))
}

function clamp(value: number, min?: number, max?: number) {
  let next = value
  if (min != null) next = Math.max(min, next)
  if (max != null) next = Math.min(max, next)
  return next
}

function syntaxPattern(allowNegative: boolean, allowDecimal: boolean) {
  if (allowDecimal) return allowNegative ? /^-?\d*(?:\.\d*)?$/ : /^\d*(?:\.\d*)?$/
  return allowNegative ? /^-?\d*$/ : /^\d*$/
}

function syntaxMessage(allowNegative: boolean, allowDecimal: boolean) {
  if (allowDecimal && allowNegative) return '请输入有效数字'
  if (allowDecimal) return '请输入非负数字'
  if (allowNegative) return '请输入整数，不能包含小数'
  return '请输入非负整数，不能包含小数或负号'
}

/**
 * Mobile-friendly numeric input with a temporary text draft.
 *
 * Current planner fields are whole-number counts, minutes and percentages, so
 * decimals and negative signs are rejected by default. Using a text input with
 * inputMode="numeric" also avoids the browser number input accepting values such
 * as 1e3, +2 or -4 on mobile. The parent only receives a valid value.
 */
export function NumericInput({
  value,
  onValueChange,
  onEmpty,
  min,
  max,
  step,
  inputMode,
  commitMode = 'change',
  allowNegative = false,
  allowDecimal = false,
  onFocus,
  onBlur,
  onChange,
  onBeforeInput,
  onPaste,
  className,
  ...rest
}: NumericInputProps) {
  const [draft, setDraft] = useState(() => displayValue(value))
  const [feedback, setFeedback] = useState<{ message: string; kind: 'error' | 'notice' }>({ message: '', kind: 'error' })
  const focused = useRef(false)
  const latestValue = useRef(value)
  latestValue.current = value

  useEffect(() => {
    if (!focused.current) setDraft(displayValue(value))
  }, [value])

  const pattern = syntaxPattern(allowNegative, allowDecimal)
  const effectiveInputMode = inputMode ?? (allowDecimal ? 'decimal' : 'numeric')
  const restoreCurrent = () => setDraft(displayValue(latestValue.current))

  const rangeMessage = (parsed: number) => {
    if (min != null && parsed < min) return `不能小于 ${min}`
    if (max != null && parsed > max) return `不能大于 ${max}`
    return ''
  }

  const rejectInsertedText = (text: string) => {
    const normalized = normalizeDigits(text)
    if (allowDecimal || allowNegative) return !pattern.test(normalized)
    return /[^0-9]/.test(normalized)
  }

  return <span className={`numeric-input-wrap${feedback.message ? ` numeric-input-${feedback.kind}` : ''}`}>
    <input
      {...rest}
      className={className}
      type="text"
      inputMode={effectiveInputMode}
      pattern={allowDecimal ? (allowNegative ? '-?[0-9]*(\\.[0-9]*)?' : '[0-9]*(\\.[0-9]*)?') : (allowNegative ? '-?[0-9]*' : '[0-9]*')}
      min={undefined}
      max={undefined}
      step={undefined}
      value={draft}
      aria-invalid={feedback.kind === 'error' && Boolean(feedback.message)}
      onFocus={(event: any) => {
        focused.current = true
        setFeedback({ message: '', kind: 'error' })
        onFocus?.(event)
        const input = event.currentTarget
        window.requestAnimationFrame(() => input.select())
      }}
      onBeforeInput={(event: any) => {
        onBeforeInput?.(event)
        if (event.defaultPrevented || !event.data) return
        if (rejectInsertedText(event.data)) {
          event.preventDefault()
          setFeedback({ message: syntaxMessage(allowNegative, allowDecimal), kind: 'error' })
        }
      }}
      onPaste={(event: any) => {
        onPaste?.(event)
        if (event.defaultPrevented) return
        const text = event.clipboardData?.getData('text') ?? ''
        if (rejectInsertedText(text)) {
          event.preventDefault()
          setFeedback({ message: syntaxMessage(allowNegative, allowDecimal), kind: 'error' })
        }
      }}
      onChange={(event: any) => {
        onChange?.(event)
        const raw = normalizeDigits(event.target.value)
        if (!pattern.test(raw)) {
          setFeedback({ message: syntaxMessage(allowNegative, allowDecimal), kind: 'error' })
          return
        }
        setDraft(raw)
        if (raw.trim() === '' || raw === '-') {
          setFeedback({ message: '', kind: 'error' })
          return
        }
        const parsed = Number(raw)
        if (!Number.isFinite(parsed) || (!allowDecimal && !Number.isInteger(parsed))) {
          setFeedback({ message: syntaxMessage(allowNegative, allowDecimal), kind: 'error' })
          return
        }
        const error = rangeMessage(parsed)
        setFeedback({ message: error, kind: 'error' })
        if (!error && commitMode === 'change' && parsed !== latestValue.current) onValueChange(parsed)
      }}
      onBlur={(event: any) => {
        focused.current = false
        const raw = normalizeDigits(draft.trim())
        if (raw === '' || raw === '-') {
          setFeedback({ message: '', kind: 'error' })
          if (onEmpty) onEmpty()
          else restoreCurrent()
        } else if (!pattern.test(raw)) {
          setFeedback({ message: syntaxMessage(allowNegative, allowDecimal), kind: 'error' })
          restoreCurrent()
        } else {
          const parsed = Number(raw)
          if (!Number.isFinite(parsed) || (!allowDecimal && !Number.isInteger(parsed))) {
            setFeedback({ message: syntaxMessage(allowNegative, allowDecimal), kind: 'error' })
            restoreCurrent()
          } else {
            const normalized = clamp(parsed, min, max)
            const wasAdjusted = normalized !== parsed
            if (normalized !== latestValue.current) onValueChange(normalized)
            setDraft(String(normalized))
            setFeedback(wasAdjusted
              ? { message: parsed < normalized ? `最小值为 ${normalized}，已自动调整` : `最大值为 ${normalized}，已自动调整`, kind: 'notice' }
              : { message: '', kind: 'error' })
          }
        }
        onBlur?.(event)
      }}
    />
    {feedback.message && <small className={`numeric-input-feedback numeric-input-feedback-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</small>}
  </span>
}
