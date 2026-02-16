import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

interface TripStop {
  time: string
  plan: string
  detail: string
  mapUrl?: string
  mapLabel?: string
  food?: string
}

interface TripDay {
  id: string
  optionLabel: string
  dateTitle: string
  sectionTitle?: string
  hotelInfo?: string
  foodHeader?: string
  items: TripStop[]
}

interface ItineraryData {
  title: string
  allOptionLabel: string
  defaultFoodHeader: string
  days: TripDay[]
}

interface Expense {
  id: number
  item: string
  amt: number
}

interface ExpenseInput {
  item: string
  amt: string
}

const EMPTY_INPUT: ExpenseInput = { item: '', amt: '' }

const sanitizeExpenses = (raw: unknown): Expense[] => {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter((value): value is Expense => {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    const exp = value as Partial<Expense>
    return (
      typeof exp.id === 'number' &&
      Number.isFinite(exp.id) &&
      typeof exp.item === 'string' &&
      typeof exp.amt === 'number' &&
      Number.isFinite(exp.amt)
    )
  })
}

const readDayExpenses = (dayId: string): Expense[] => {
  try {
    const raw = localStorage.getItem(`exp-${dayId}`)
    if (!raw) {
      return []
    }
    return sanitizeExpenses(JSON.parse(raw))
  } catch {
    return []
  }
}

const writeDayExpenses = (dayId: string, expenses: Expense[]): void => {
  try {
    localStorage.setItem(`exp-${dayId}`, JSON.stringify(expenses))
  } catch {
    // Ignore storage write errors (private mode/quota).
  }
}

const formatYen = (value: number): string => `¥${value.toLocaleString('ja-JP')}`

function App() {
  const [itinerary, setItinerary] = useState<ItineraryData | null>(null)
  const [selectedDay, setSelectedDay] = useState('all')
  const [expensesByDay, setExpensesByDay] = useState<Record<string, Expense[]>>({})
  const [inputsByDay, setInputsByDay] = useState<Record<string, ExpenseInput>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const loadItinerary = async (): Promise<void> => {
      try {
        const dataUrl = `${import.meta.env.BASE_URL}data/itinerary.json`
        const response = await fetch(dataUrl)

        if (!response.ok) {
          throw new Error(`Failed to load itinerary: ${response.status}`)
        }

        const data = (await response.json()) as ItineraryData
        setItinerary(data)
      } catch {
        setErrorMessage('일정 데이터를 불러오지 못했습니다. JSON 경로를 확인하세요.')
      }
    }

    void loadItinerary()
  }, [])

  useEffect(() => {
    if (!itinerary) {
      return
    }

    const nextExpenses = itinerary.days.reduce<Record<string, Expense[]>>((acc, day) => {
      acc[day.id] = readDayExpenses(day.id)
      return acc
    }, {})

    const nextInputs = itinerary.days.reduce<Record<string, ExpenseInput>>((acc, day) => {
      acc[day.id] = { ...EMPTY_INPUT }
      return acc
    }, {})

    setExpensesByDay(nextExpenses)
    setInputsByDay(nextInputs)
  }, [itinerary])

  const visibleDays = useMemo(() => {
    if (!itinerary) {
      return []
    }
    return itinerary.days.filter((day) => selectedDay === 'all' || day.id === selectedDay)
  }, [itinerary, selectedDay])

  const handleDayChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setSelectedDay(event.target.value)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const updateInput = (dayId: string, field: keyof ExpenseInput, value: string): void => {
    setInputsByDay((prev) => ({
      ...prev,
      [dayId]: {
        ...(prev[dayId] ?? EMPTY_INPUT),
        [field]: value,
      },
    }))
  }

  const handleAddExpense = (dayId: string, event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const currentInput = inputsByDay[dayId] ?? EMPTY_INPUT
    const item = currentInput.item.trim()
    const amount = Number.parseInt(currentInput.amt, 10)

    if (!item || Number.isNaN(amount) || amount <= 0) {
      return
    }

    const newExpense: Expense = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      item,
      amt: amount,
    }

    setExpensesByDay((prev) => {
      const nextDayExpenses = [...(prev[dayId] ?? []), newExpense]
      writeDayExpenses(dayId, nextDayExpenses)
      return { ...prev, [dayId]: nextDayExpenses }
    })

    setInputsByDay((prev) => ({
      ...prev,
      [dayId]: { ...EMPTY_INPUT },
    }))
  }

  const handleDeleteExpense = (dayId: string, expenseId: number): void => {
    setExpensesByDay((prev) => {
      const nextDayExpenses = (prev[dayId] ?? []).filter((expense) => expense.id !== expenseId)
      writeDayExpenses(dayId, nextDayExpenses)
      return { ...prev, [dayId]: nextDayExpenses }
    })
  }

  if (errorMessage) {
    return (
      <main className="trip-page">
        <h1 className="page-title">✈️ 9박 10일 간사이 여행 명령서 (Expert)</h1>
        <p className="error-message">{errorMessage}</p>
      </main>
    )
  }

  if (!itinerary) {
    return (
      <main className="trip-page">
        <h1 className="page-title">✈️ 9박 10일 간사이 여행 명령서 (Expert)</h1>
        <p className="loading-message">일정 데이터를 불러오는 중...</p>
      </main>
    )
  }

  return (
    <main className="trip-page">
      <h1 className="page-title">{itinerary.title}</h1>

      <div className="nav-container">
        <select className="day-selector" value={selectedDay} onChange={handleDayChange}>
          <option value="all">{itinerary.allOptionLabel}</option>
          {itinerary.days.map((day) => (
            <option key={day.id} value={day.id}>
              {day.optionLabel}
            </option>
          ))}
        </select>
      </div>

      {visibleDays.map((day) => {
        const expenses = expensesByDay[day.id] ?? []
        const total = expenses.reduce((sum, expense) => sum + expense.amt, 0)
        const input = inputsByDay[day.id] ?? EMPTY_INPUT
        const foodHeader = day.foodHeader ?? itinerary.defaultFoodHeader

        return (
          <section key={day.id} className="day-section">
            {day.sectionTitle ? <h2 className="section-title">{day.sectionTitle}</h2> : null}
            {day.hotelInfo ? <div className="hotel-info">{day.hotelInfo}</div> : null}
            <h3 className="date-title">{day.dateTitle}</h3>

            <table>
              <thead>
                <tr>
                  <th className="col-time">시간</th>
                  <th className="col-plan">일정</th>
                  <th className="col-detail">이동 정보</th>
                  <th className="col-map">구글맵</th>
                  <th className="col-food">{foodHeader}</th>
                </tr>
              </thead>
              <tbody>
                {day.items.map((stop, index) => (
                  <tr key={`${day.id}-${stop.time}-${index}`}>
                    <td className="col-time">{stop.time}</td>
                    <td className="col-plan">{stop.plan}</td>
                    <td className="col-detail">{stop.detail}</td>
                    <td className="col-map">
                      {stop.mapUrl ? (
                        <a
                          href={stop.mapUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="map-btn"
                        >
                          {stop.mapLabel ?? '🗺️ 지도'}
                        </a>
                      ) : null}
                    </td>
                    <td className="col-food">{stop.food ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="account-book">
              <div className="acc-header">
                <span>💰 {day.id.toUpperCase()} 가계부</span>
                <span className="acc-total">{formatYen(total)}</span>
              </div>

              <form className="expense-form" onSubmit={(event) => handleAddExpense(day.id, event)}>
                <input
                  type="text"
                  className="input-field"
                  placeholder="항목"
                  value={input.item}
                  onChange={(event) => updateInput(day.id, 'item', event.target.value)}
                />
                <input
                  type="number"
                  className="input-field amount"
                  placeholder="금액"
                  value={input.amt}
                  onChange={(event) => updateInput(day.id, 'amt', event.target.value)}
                />
                <button className="btn-save" type="submit">
                  저장
                </button>
              </form>

              <ul className="expense-list">
                {expenses.map((expense) => (
                  <li key={expense.id} className="expense-item">
                    <span>{expense.item}</span>
                    <span>
                      {formatYen(expense.amt)}{' '}
                      <button
                        type="button"
                        className="btn-delete"
                        onClick={() => handleDeleteExpense(day.id, expense.id)}
                      >
                        x
                      </button>
                    </span>
                  </li>
                ))}
                {expenses.length === 0 ? <li className="empty-expense">저장된 지출이 없습니다.</li> : null}
              </ul>
            </div>
          </section>
        )
      })}
    </main>
  )
}

export default App
