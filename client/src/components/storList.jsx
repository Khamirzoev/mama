export function StorList({ items, onClear }) {
  if (!items.length) return null

  function prayerWord(count) {
    const lastTwoDigits = count % 100
    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return 'намазов'

    switch (count % 10) {
      case 1:
        return 'намаз'
      case 2:
      case 3:
      case 4:
        return 'намаза'
      default:
        return 'намазов'
    }
  }

  return (
    <section className="history">
      <div className="history-heading">
        <h2>Последние сохранения</h2>
        <button type="button" onClick={onClear}>Очистить</button>
      </div>
      <div className="history-list">
        {items.map((item) => {
          const total = Object.values(item.counts).reduce(
            (sum, value) => sum + value,
            0,
          )
          const date = new Intl.DateTimeFormat('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(item.savedAt))

          return (
            <div className="history-item" key={item.savedAt}>
              <span>{date}</span>
              <strong>{total} {prayerWord(total)}</strong>
            </div>
          )
        })}
      </div>
    </section>
  )
}