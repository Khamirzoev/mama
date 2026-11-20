export function Schot({ value, onChange }) {
  return (
    <div className="counter" aria-label="Счётчик ракаатов">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value === 0}
        aria-label="Уменьшить"
      >
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Увеличить"
      >
        +
      </button>
    </div>
  )
}