export interface TripRow {
  id: string
  title: string
  destination: string
  start_date: string
  end_date: string
  currency: string
  memo: string | null
  status: 'draft' | 'active' | 'done'
  created_at: string
  updated_at: string
}

export interface DayRow {
  id: string
  trip_id: string
  day_no: number
  date: string
  title: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export interface PlanRow {
  id: string
  trip_id: string
  day_id: string
  start_min: number | null
  end_min: number | null
  place: string
  detail: string | null
  map_url: string | null
  food: string | null
  transport: string | null
  cost_estimate: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ExpenseRow {
  id: string
  trip_id: string
  day_id: string | null
  item: string
  amount: number
  currency: string
  category: string | null
  spent_at: string
  note: string | null
  created_at: string
  updated_at: string
}

export interface FlightRow {
  id: string
  trip_id: string
  from_code: string
  to_code: string
  depart_at: string
  arrive_at: string
  airline: string
  flight_no: string
}

export interface HotelRow {
  id: string
  trip_id: string
  name: string
  city: string
  check_in_date: string
  check_out_date: string
}

export interface TripsListResponse {
  ok: boolean
  items: TripRow[]
}

export interface TripDetailResponse {
  ok: boolean
  trip: TripRow
  days: DayRow[]
  plans: PlanRow[]
  expenses: ExpenseRow[]
  flights: FlightRow[]
  hotels: HotelRow[]
}

export interface CreateTripPayload {
  title: string
  destination: string
  startDate: string
  endDate: string
  currency: string
  memo: string
  status: 'draft' | 'active' | 'done'
}

export interface CreatePlanPayload {
  dayId: string
  place: string
  detail?: string
  startMin?: number
}

export interface CreateExpensePayload {
  dayId: string
  item: string
  amount: number
  currency: string
  category?: string
  note?: string
}

export interface ApiOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
  skipAuth?: boolean
}

const asErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return '알 수 없는 오류가 발생했습니다.'
}

export const getErrorMessage = asErrorMessage

export async function apiRequest<T>(
  apiBase: string,
  path: string,
  password: string,
  options: ApiOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (!options.skipAuth) {
    headers['X-App-Password'] = password
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  })

  const data = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    const message =
      typeof data.error === 'string'
        ? data.error
        : `요청 실패: ${response.status} ${response.statusText}`
    throw new Error(message)
  }

  return data as T
}

export const verifyPassword = (apiBase: string, password: string): Promise<{ ok: boolean }> =>
  apiRequest(apiBase, '/auth/verify', password, {
    method: 'POST',
    body: JSON.stringify({ password }),
    skipAuth: true,
  })
