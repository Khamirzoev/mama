export function Save({ onSave, disabled = false }) {
  return (
    <button className="save-button" type="button" onClick={onSave} disabled={disabled}>
      Сохранить партию
    </button>
  )
}