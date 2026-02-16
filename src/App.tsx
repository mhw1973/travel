import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  type ApiOptions,
  apiRequest,
  getErrorMessage,
  type CreateExpensePayload,
  type CreatePlanPayload,
  type CreateTripPayload,
  type DayRow,
  type ExpenseRow,
  type PlanRow,
  type TripDetailResponse,
  type TripRow,
  type TripsListResponse,
  verifyPassword,
} from './api'
import './App.css'

type Screen = 'auth' | 'home' | 'new' | 'load' | 'trip'

const PASS_KEY = 'travel_app_password'
const API_BASE = (import.meta.env.VITE_API_BASE?.trim() || 'http://127.0.0.1:8787').replace(/\/$/, '')

const formatMoney = (amount: number, currency: string): string =>
  new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).format(amount)

const toTimeLabel = (value: number | null): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-'
  }
  const hh = String(Math.floor(value / 60)).padStart(2, '0')
  const mm = String(value % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

function App() {
  const [screen, setScreen] = useState<Screen>('auth')
  const [password, setPassword] = useState(localStorage.getItem(PASS_KEY) ?? '')
  const [authInput, setAuthInput] = useState(localStorage.getItem(PASS_KEY) ?? '')
  const [trips, setTrips] = useState<TripRow[]>([])
  const [trip, setTrip] = useState<TripRow | null>(null)
  const [days, setDays] = useState<DayRow[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [selectedDay, setSelectedDay] = useState('all')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [newTrip, setNewTrip] = useState<CreateTripPayload>({
    title: '',
    destination: '',
    startDate: '',
    endDate: '',
    currency: 'JPY',
    memo: '',
    status: 'draft',
  })
  const [newPlan, setNewPlan] = useState({ place: '', detail: '', startTime: '' })
  const [newExpense, setNewExpense] = useState({ item: '', amount: '', category: '' })

  const visibleDays = useMemo(() => {
    if (selectedDay === 'all') {
      return days
    }
    return days.filter((day) => day.id === selectedDay)
  }, [days, selectedDay])

  const selectedDayId = selectedDay === 'all' ? days[0]?.id ?? '' : selectedDay
  const selectedDayCurrency = trip?.currency ?? 'JPY'

  const mapTripData = (data: TripDetailResponse): void => {
    setTrip(data.trip)
    setDays(data.days)
    setPlans(data.plans)
    setExpenses(data.expenses)
    setSelectedDay('all')
    setScreen('trip')
  }

  const callApi = async <T,>(path: string, options?: ApiOptions): Promise<T> =>
    apiRequest<T>(API_BASE, path, password, options)

  const handleVerifyPassword = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      await verifyPassword(API_BASE, authInput)
      setPassword(authInput)
      localStorage.setItem(PASS_KEY, authInput)
      setScreen('home')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const loadTrips = async (): Promise<void> => {
    setLoading(true)
    setMessage(null)
    try {
      const data = await callApi<TripsListResponse>('/api/trips')
      setTrips(data.items)
      setScreen('load')
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const openTrip = async (tripId: string): Promise<void> => {
    setLoading(true)
    setMessage(null)
    try {
      const data = await callApi<TripDetailResponse>(`/api/trips/${encodeURIComponent(tripId)}`)
      mapTripData(data)
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const submitNewTrip = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      const created = await callApi<{ trip: TripRow }>('/api/trips', {
        method: 'POST',
        body: JSON.stringify(newTrip),
      })
      await openTrip(created.trip.id)
      setNewTrip({ title: '', destination: '', startDate: '', endDate: '', currency: 'JPY', memo: '', status: 'draft' })
    } catch (error) {
      setMessage(getErrorMessage(error))
      setLoading(false)
    }
  }

  const addPlan = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!trip || !selectedDayId) {
      return
    }
    const payload: CreatePlanPayload = {
      dayId: selectedDayId,
      place: newPlan.place.trim(),
      detail: newPlan.detail.trim() || undefined,
      startMin: newPlan.startTime ? Number.parseInt(newPlan.startTime, 10) : undefined,
    }
    if (!payload.place) {
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      await callApi(`/api/trips/${encodeURIComponent(trip.id)}/plans`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await openTrip(trip.id)
      setNewPlan({ place: '', detail: '', startTime: '' })
    } catch (error) {
      setMessage(getErrorMessage(error))
      setLoading(false)
    }
  }

  const addExpense = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!trip || !selectedDayId) {
      return
    }
    const amount = Number.parseInt(newExpense.amount, 10)
    if (!newExpense.item.trim() || Number.isNaN(amount) || amount <= 0) {
      return
    }
    const payload: CreateExpensePayload = {
      dayId: selectedDayId,
      item: newExpense.item.trim(),
      amount,
      currency: selectedDayCurrency,
      category: newExpense.category.trim() || undefined,
    }
    setLoading(true)
    setMessage(null)
    try {
      await callApi(`/api/trips/${encodeURIComponent(trip.id)}/expenses`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await openTrip(trip.id)
      setNewExpense({ item: '', amount: '', category: '' })
    } catch (error) {
      setMessage(getErrorMessage(error))
      setLoading(false)
    }
  }

  const logout = (): void => {
    localStorage.removeItem(PASS_KEY)
    setPassword('')
    setAuthInput('')
    setScreen('auth')
    setTrip(null)
    setDays([])
    setPlans([])
    setExpenses([])
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1>Travel Command Center</h1>
        {screen !== 'auth' ? (
          <button type="button" className="btn ghost" onClick={logout}>
            로그아웃
          </button>
        ) : null}
      </header>

      {message ? <p className="notice error">{message}</p> : null}
      {loading ? <p className="notice">처리 중...</p> : null}

      {screen === 'auth' ? (
        <form className="panel" onSubmit={handleVerifyPassword}>
          <h2>비밀번호 인증</h2>
          <input type="password" value={authInput} onChange={(e) => setAuthInput(e.target.value)} placeholder="앱 비밀번호" required />
          <button type="submit" className="btn primary" disabled={loading}>
            시작하기
          </button>
        </form>
      ) : null}

      {screen === 'home' ? (
        <section className="panel">
          <h2>무엇을 할까요?</h2>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => setScreen('new')}>
              새여행
            </button>
            <button type="button" className="btn secondary" onClick={() => void loadTrips()}>
              여행불러오기
            </button>
          </div>
        </section>
      ) : null}

      {screen === 'new' ? (
        <form className="panel grid-form" onSubmit={submitNewTrip}>
          <h2>새여행 만들기</h2>
          <input value={newTrip.title} onChange={(e) => setNewTrip({ ...newTrip, title: e.target.value })} placeholder="여행 제목" required />
          <input value={newTrip.destination} onChange={(e) => setNewTrip({ ...newTrip, destination: e.target.value })} placeholder="여행지" required />
          <label>시작일<input type="date" value={newTrip.startDate} onChange={(e) => setNewTrip({ ...newTrip, startDate: e.target.value })} required /></label>
          <label>종료일<input type="date" value={newTrip.endDate} onChange={(e) => setNewTrip({ ...newTrip, endDate: e.target.value })} required /></label>
          <select value={newTrip.currency} onChange={(e) => setNewTrip({ ...newTrip, currency: e.target.value })}>
            <option value="JPY">JPY</option>
            <option value="KRW">KRW</option>
            <option value="USD">USD</option>
          </select>
          <textarea value={newTrip.memo} onChange={(e) => setNewTrip({ ...newTrip, memo: e.target.value })} placeholder="메모 (선택)" rows={3} />
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setScreen('home')}>뒤로</button>
            <button type="submit" className="btn primary" disabled={loading}>생성</button>
          </div>
        </form>
      ) : null}

      {screen === 'load' ? (
        <section className="panel">
          <h2>여행불러오기</h2>
          <div className="trip-list">
            {trips.map((item) => (
              <button key={item.id} type="button" className="trip-card" onClick={() => void openTrip(item.id)}>
                <strong>{item.title}</strong>
                <span>{item.destination}</span>
                <span>{item.start_date} ~ {item.end_date}</span>
              </button>
            ))}
            {trips.length === 0 ? <p>저장된 여행이 없습니다.</p> : null}
          </div>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setScreen('home')}>뒤로</button>
          </div>
        </section>
      ) : null}

      {screen === 'trip' && trip ? (
        <section className="panel">
          <h2>{trip.title}</h2>
          <p className="muted">{trip.destination} | {trip.start_date} ~ {trip.end_date}</p>
          <label>일자 선택
            <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)}>
              <option value="all">전체</option>
              {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_no} ({day.date})</option>)}
            </select>
          </label>

          {visibleDays.map((day) => {
            const dayPlans = plans.filter((plan) => plan.day_id === day.id)
            const dayExpenses = expenses.filter((expense) => expense.day_id === day.id)
            const total = dayExpenses.reduce((sum, item) => sum + item.amount, 0)
            return (
              <article key={day.id} className="day-card">
                <h3>Day {day.day_no} | {day.date}</h3>
                <table>
                  <thead><tr><th>시간</th><th>일정</th><th>상세</th></tr></thead>
                  <tbody>
                    {dayPlans.map((plan) => <tr key={plan.id}><td>{toTimeLabel(plan.start_min)}</td><td>{plan.place}</td><td>{plan.detail ?? '-'}</td></tr>)}
                    {dayPlans.length === 0 ? <tr><td colSpan={3}>등록된 일정 없음</td></tr> : null}
                  </tbody>
                </table>
                <p className="muted">지출합계: {formatMoney(total, trip.currency)}</p>
              </article>
            )
          })}

          {selectedDay !== 'all' ? (
            <div className="inline-forms">
              <form className="subform" onSubmit={addPlan}>
                <h3>일정 추가</h3>
                <input value={newPlan.place} onChange={(e) => setNewPlan({ ...newPlan, place: e.target.value })} placeholder="장소/일정명" required />
                <input value={newPlan.detail} onChange={(e) => setNewPlan({ ...newPlan, detail: e.target.value })} placeholder="상세" />
                <input type="number" value={newPlan.startTime} onChange={(e) => setNewPlan({ ...newPlan, startTime: e.target.value })} placeholder="시작분(09:30=570)" />
                <button type="submit" className="btn secondary">추가</button>
              </form>

              <form className="subform" onSubmit={addExpense}>
                <h3>지출 추가</h3>
                <input value={newExpense.item} onChange={(e) => setNewExpense({ ...newExpense, item: e.target.value })} placeholder="항목" required />
                <input type="number" value={newExpense.amount} onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })} placeholder="금액" required />
                <input value={newExpense.category} onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })} placeholder="분류(선택)" />
                <button type="submit" className="btn secondary">추가</button>
              </form>
            </div>
          ) : (
            <p className="muted">일정/지출 추가는 특정 Day를 선택하면 활성화됩니다.</p>
          )}

          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setScreen('home')}>홈으로</button>
          </div>
        </section>
      ) : null}
    </main>
  )
}

export default App
