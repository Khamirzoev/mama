export function Schot({ value, onChange, disabled = false }) {
  return (
    <div className="counter" aria-label="Счётчик намазов">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value === 0}
        aria-label="Уменьшить"
      >
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled}
        aria-label="Увеличить"
      >
        +
      </button>
    </div>
  )
}