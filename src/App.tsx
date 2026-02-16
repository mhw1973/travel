import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  type ApiOptions,
  apiRequest,
  type CreateFlightInput,
  getErrorMessage,
  type CreateExpensePayload,
  type CreateHotelInput,
  type CreatePlanPayload,
  type CreateTripPayload,
  type DayRow,
  type ExpenseRow,
  type FlightRow,
  type HotelRow,
  type PlanRow,
  type FlightLookupResponse,
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

const toOptionalInt = (value: string): number | undefined => {
  if (!value) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

const toDateTimeLocalValue = (iso: string | null): string => {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

const buildGoogleMapsSearchUrl = (query: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`

const airportQueryFromFlight = (
  airportName: string,
  code: string,
): string => {
  const name = airportName.trim()
  const iata = code.trim().toUpperCase()
  if (name && iata) {
    return `${name} ${iata} airport`
  }
  if (name) {
    return `${name} airport`
  }
  return `${iata} airport`
}

interface NewFlightForm {
  legType: 'outbound' | 'inbound' | 'multi'
  legOrder: string
  fromCode: string
  fromAirport: string
  toCode: string
  toAirport: string
  departAt: string
  arriveAt: string
  airline: string
  flightNo: string
  price: string
}

interface NewHotelForm {
  name: string
  city: string
  checkInDate: string
  checkOutDate: string
  totalPrice: string
}

const EMPTY_FLIGHT_FORM: NewFlightForm = {
  legType: 'multi',
  legOrder: '1',
  fromCode: '',
  fromAirport: '',
  toCode: '',
  toAirport: '',
  departAt: '',
  arriveAt: '',
  airline: '',
  flightNo: '',
  price: '',
}

const EMPTY_HOTEL_FORM: NewHotelForm = {
  name: '',
  city: '',
  checkInDate: '',
  checkOutDate: '',
  totalPrice: '',
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
  const [flights, setFlights] = useState<FlightRow[]>([])
  const [hotels, setHotels] = useState<HotelRow[]>([])
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
  const [newTripFlights, setNewTripFlights] = useState<NewFlightForm[]>([])
  const [newTripHotels, setNewTripHotels] = useState<NewHotelForm[]>([])
  const [flightLookupIndex, setFlightLookupIndex] = useState<number | null>(null)

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
    setFlights(data.flights)
    setHotels(data.hotels)
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

  const addFlightDraft = (): void => {
    setNewTripFlights((prev) => [...prev, { ...EMPTY_FLIGHT_FORM, legOrder: String(prev.length + 1) }])
  }

  const updateFlightDraft = (index: number, key: keyof NewFlightForm, value: string): void => {
    setNewTripFlights((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [key]: value } : item)),
    )
  }

  const removeFlightDraft = (index: number): void => {
    setNewTripFlights((prev) => prev.filter((_, idx) => idx !== index))
    setFlightLookupIndex((prev) => {
      if (prev === null) {
        return null
      }
      if (prev === index) {
        return null
      }
      return prev > index ? prev - 1 : prev
    })
  }

  const addHotelDraft = (): void => {
    setNewTripHotels((prev) => [...prev, { ...EMPTY_HOTEL_FORM }])
  }

  const updateHotelDraft = (index: number, key: keyof NewHotelForm, value: string): void => {
    setNewTripHotels((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [key]: value } : item)),
    )
  }

  const removeHotelDraft = (index: number): void => {
    setNewTripHotels((prev) => prev.filter((_, idx) => idx !== index))
  }

  const lookupFlightByNumber = async (index: number): Promise<void> => {
    const draft = newTripFlights[index]
    if (!draft) {
      return
    }

    const flightIata = draft.flightNo.trim().toUpperCase()
    if (!flightIata) {
      return
    }

    const date = draft.departAt ? draft.departAt.slice(0, 10) : newTrip.startDate
    const query = new URLSearchParams({ flightIata })
    if (date) {
      query.set('date', date)
    }

    setFlightLookupIndex(index)
    setMessage(null)
    try {
      const data = await callApi<FlightLookupResponse>(`/api/flight-lookup?${query.toString()}`)
      setNewTripFlights((prev) =>
        prev.map((item, idx) => {
          if (idx !== index) {
            return item
          }
          return {
            ...item,
            fromCode: data.item.fromCode ?? item.fromCode,
            fromAirport: data.item.fromAirport ?? item.fromAirport,
            toCode: data.item.toCode ?? item.toCode,
            toAirport: data.item.toAirport ?? item.toAirport,
            departAt: data.item.departAt ? toDateTimeLocalValue(data.item.departAt) : item.departAt,
            arriveAt: data.item.arriveAt ? toDateTimeLocalValue(data.item.arriveAt) : item.arriveAt,
            airline: data.item.airline ?? item.airline,
            flightNo: data.item.flightNo || item.flightNo,
          }
        }),
      )
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setFlightLookupIndex(null)
    }
  }

  const mapCreateFlights = (): CreateFlightInput[] =>
    newTripFlights
      .filter(
        (item) =>
          item.fromCode.trim() &&
          item.toCode.trim() &&
          item.departAt &&
          item.arriveAt &&
          item.airline.trim() &&
          item.flightNo.trim(),
      )
      .map((item) => ({
        legType: item.legType,
        legOrder: toOptionalInt(item.legOrder),
        fromCode: item.fromCode.trim().toUpperCase(),
        fromAirport: item.fromAirport.trim() || undefined,
        toCode: item.toCode.trim().toUpperCase(),
        toAirport: item.toAirport.trim() || undefined,
        departAt: new Date(item.departAt).toISOString(),
        arriveAt: new Date(item.arriveAt).toISOString(),
        airline: item.airline.trim(),
        flightNo: item.flightNo.trim(),
        price: toOptionalInt(item.price),
        currency: newTrip.currency,
      }))

  const mapCreateHotels = (): CreateHotelInput[] =>
    newTripHotels
      .filter(
        (item) =>
          item.name.trim() &&
          item.city.trim() &&
          item.checkInDate &&
          item.checkOutDate,
      )
      .map((item) => ({
        name: item.name.trim(),
        city: item.city.trim(),
        checkInDate: item.checkInDate,
        checkOutDate: item.checkOutDate,
        totalPrice: toOptionalInt(item.totalPrice),
        currency: newTrip.currency,
      }))

  const submitNewTrip = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      const payload: CreateTripPayload = {
        ...newTrip,
        flights: mapCreateFlights(),
        hotels: mapCreateHotels(),
      }
      const created = await callApi<{ trip: TripRow }>('/api/trips', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await openTrip(created.trip.id)
      setNewTrip({ title: '', destination: '', startDate: '', endDate: '', currency: 'JPY', memo: '', status: 'draft' })
      setNewTripFlights([])
      setNewTripHotels([])
      setFlightLookupIndex(null)
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
    setFlights([])
    setHotels([])
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

          <section className="draft-section">
            <div className="draft-header">
              <h3>항공편 (여러 개 가능)</h3>
              <button type="button" className="btn ghost" onClick={addFlightDraft}>+ 항공편</button>
            </div>
            {newTripFlights.map((flight, index) => (
              <div className="draft-card" key={`flight-${index}`}>
                <div className="draft-grid">
                  <select value={flight.legType} onChange={(e) => updateFlightDraft(index, 'legType', e.target.value)}>
                    <option value="outbound">출국</option>
                    <option value="inbound">귀국</option>
                    <option value="multi">다구간</option>
                  </select>
                  <input type="number" value={flight.legOrder} onChange={(e) => updateFlightDraft(index, 'legOrder', e.target.value)} placeholder="구간 순서" />
                  <input value={flight.fromCode} onChange={(e) => updateFlightDraft(index, 'fromCode', e.target.value)} placeholder="출발 코드 (ICN)" />
                  <input value={flight.fromAirport} onChange={(e) => updateFlightDraft(index, 'fromAirport', e.target.value)} placeholder="출발 공항명(선택)" />
                  <input value={flight.toCode} onChange={(e) => updateFlightDraft(index, 'toCode', e.target.value)} placeholder="도착 코드 (KIX)" />
                  <input value={flight.toAirport} onChange={(e) => updateFlightDraft(index, 'toAirport', e.target.value)} placeholder="도착 공항명(선택)" />
                  <input type="datetime-local" value={flight.departAt} onChange={(e) => updateFlightDraft(index, 'departAt', e.target.value)} />
                  <input type="datetime-local" value={flight.arriveAt} onChange={(e) => updateFlightDraft(index, 'arriveAt', e.target.value)} />
                  <input value={flight.airline} onChange={(e) => updateFlightDraft(index, 'airline', e.target.value)} placeholder="항공사" />
                  <input
                    value={flight.flightNo}
                    onChange={(e) => updateFlightDraft(index, 'flightNo', e.target.value)}
                    onBlur={() => void lookupFlightByNumber(index)}
                    placeholder="편명 (입력 후 자동조회)"
                  />
                  <input type="number" value={flight.price} onChange={(e) => updateFlightDraft(index, 'price', e.target.value)} placeholder="금액(선택)" />
                </div>
                <div className="actions">
                  <a
                    className="btn ghost map-link"
                    href={buildGoogleMapsSearchUrl(airportQueryFromFlight(flight.fromAirport, flight.fromCode))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    출발공항 지도
                  </a>
                  <a
                    className="btn ghost map-link"
                    href={buildGoogleMapsSearchUrl(airportQueryFromFlight(flight.toAirport, flight.toCode))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    도착공항 지도
                  </a>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => void lookupFlightByNumber(index)}
                    disabled={flightLookupIndex === index}
                  >
                    {flightLookupIndex === index ? '조회중...' : '편명 조회'}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => removeFlightDraft(index)}>삭제</button>
                </div>
                <p className="muted">지도는 새 탭으로 열립니다. 이 앱 탭으로 돌아오면 계속 입력할 수 있습니다.</p>
              </div>
            ))}
          </section>

          <section className="draft-section">
            <div className="draft-header">
              <h3>호텔 (여러 개 가능)</h3>
              <button type="button" className="btn ghost" onClick={addHotelDraft}>+ 호텔</button>
            </div>
            {newTripHotels.map((hotel, index) => (
              <div className="draft-card" key={`hotel-${index}`}>
                <div className="draft-grid">
                  <input value={hotel.name} onChange={(e) => updateHotelDraft(index, 'name', e.target.value)} placeholder="호텔명" />
                  <input value={hotel.city} onChange={(e) => updateHotelDraft(index, 'city', e.target.value)} placeholder="도시" />
                  <input type="date" value={hotel.checkInDate} onChange={(e) => updateHotelDraft(index, 'checkInDate', e.target.value)} />
                  <input type="date" value={hotel.checkOutDate} onChange={(e) => updateHotelDraft(index, 'checkOutDate', e.target.value)} />
                  <input type="number" value={hotel.totalPrice} onChange={(e) => updateHotelDraft(index, 'totalPrice', e.target.value)} placeholder="총 숙박비(선택)" />
                </div>
                <div className="actions">
                  <a
                    className="btn ghost map-link"
                    href={buildGoogleMapsSearchUrl(`${hotel.name} ${hotel.city}`.trim() || 'hotel')}
                    target="_blank"
                    rel="noreferrer"
                  >
                    호텔 지도
                  </a>
                  <button type="button" className="btn ghost" onClick={() => removeHotelDraft(index)}>삭제</button>
                </div>
                <p className="muted">지도는 새 탭으로 열립니다. 앱 탭으로 바로 돌아올 수 있습니다.</p>
              </div>
            ))}
          </section>

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

          <div className="meta-grid">
            <section className="meta-card">
              <h3>항공편</h3>
              {flights.length === 0 ? (
                <p className="muted">등록된 항공편 없음</p>
              ) : (
                <ul className="meta-list">
                  {flights.map((flight) => (
                    <li key={flight.id}>
                      <strong>
                        [{flight.leg_type}/{flight.leg_order}] {flight.from_code} {'->'} {flight.to_code}
                      </strong>
                      <span>{flight.airline} {flight.flight_no}</span>
                      <span className="map-links-inline">
                        <a
                          className="inline-link"
                          href={buildGoogleMapsSearchUrl(
                            airportQueryFromFlight(flight.from_airport ?? '', flight.from_code),
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          출발공항 지도
                        </a>
                        <a
                          className="inline-link"
                          href={buildGoogleMapsSearchUrl(
                            airportQueryFromFlight(flight.to_airport ?? '', flight.to_code),
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          도착공항 지도
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="meta-card">
              <h3>호텔</h3>
              {hotels.length === 0 ? (
                <p className="muted">등록된 호텔 없음</p>
              ) : (
                <ul className="meta-list">
                  {hotels.map((hotel) => (
                    <li key={hotel.id}>
                      <strong>{hotel.name}</strong>
                      <span>{hotel.city} | {hotel.check_in_date} ~ {hotel.check_out_date}</span>
                      <span className="map-links-inline">
                        <a
                          className="inline-link"
                          href={buildGoogleMapsSearchUrl(`${hotel.name} ${hotel.city}`)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          호텔 지도
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

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
