import { createClient, type Client } from '@libsql/client/web'

interface Env {
  TURSO_DATABASE_URL: string
  TURSO_AUTH_TOKEN: string
  APP_PASSWORD: string
  ALLOWED_ORIGIN: string
  AVIATIONSTACK_ACCESS_KEY?: string
}

type JsonBody = Record<string, unknown>
type ResourceName = 'days' | 'plans' | 'expenses' | 'flights' | 'hotels'

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const STATUS_VALUES = new Set(['draft', 'active', 'done'])
const RESOURCE_ORDER: Record<ResourceName, string> = {
  days: 'ORDER BY day_no ASC, date ASC',
  plans: 'ORDER BY sort_order ASC, start_min ASC, id ASC',
  expenses: 'ORDER BY spent_at DESC, id DESC',
  flights: 'ORDER BY leg_order ASC, depart_at ASC, id ASC',
  hotels: 'ORDER BY check_in_date ASC, id ASC',
}

const CORS_ALLOWED_HEADERS = 'Content-Type, Authorization, X-App-Password'
const CORS_ALLOWED_METHODS = 'GET, POST, PATCH, PUT, DELETE, OPTIONS'

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const normalizePath = (pathname: string): string =>
  pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname

const parseAllowedOrigins = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

const isOriginAllowed = (origin: string, allowedOrigins: string[]): boolean => {
  if (allowedOrigins.length === 0) {
    return true
  }
  return allowedOrigins.includes(origin) || allowedOrigins.includes('*')
}

const buildCorsHeaders = (request: Request, allowedOrigins: string[]): Headers => {
  const origin = request.headers.get('origin')
  const headers = new Headers()

  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    headers.set('Access-Control-Allow-Origin', origin)
  } else if (allowedOrigins.length > 0 && !allowedOrigins.includes('*')) {
    headers.set('Access-Control-Allow-Origin', allowedOrigins[0])
  } else {
    headers.set('Access-Control-Allow-Origin', '*')
  }

  headers.set('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS)
  headers.set('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS)
  headers.set('Vary', 'Origin')
  return headers
}

const json = (data: unknown, status: number, corsHeaders: Headers): Response => {
  const headers = new Headers(corsHeaders)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { status, headers })
}

const errorJson = (status: number, message: string, corsHeaders: Headers): Response =>
  json({ ok: false, error: message }, status, corsHeaders)

const decodeSegment = (segment: string): string => decodeURIComponent(segment)

const readJson = async (request: Request): Promise<JsonBody> => {
  try {
    const body = (await request.json()) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'JSON object body is required')
    }
    return body as JsonBody
  } catch (error) {
    if (error instanceof HttpError) {
      throw error
    }
    throw new HttpError(400, 'Invalid JSON body')
  }
}

const readHeaderPassword = (request: Request): string | null => {
  const direct = request.headers.get('x-app-password')
  if (direct) {
    return direct
  }

  const auth = request.headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  return null
}

const requireAuth = (request: Request, env: Env): void => {
  const password = readHeaderPassword(request)
  if (!password || password !== env.APP_PASSWORD) {
    throw new HttpError(401, 'Unauthorized')
  }
}

const nowIso = (): string => new Date().toISOString()
const makeId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`

const valueOf = (body: JsonBody, keys: string[]): unknown => {
  for (const key of keys) {
    if (hasOwn(body, key)) {
      return body[key]
    }
  }
  return undefined
}

const hasAnyKey = (body: JsonBody, keys: string[]): boolean => {
  for (const key of keys) {
    if (hasOwn(body, key)) {
      return true
    }
  }
  return false
}

const asRequiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} is required`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new HttpError(400, `${label} is required`)
  }
  return trimmed
}

const asOptionalString = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

const asRequiredInteger = (value: unknown, label: string): number => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed)) {
      return parsed
    }
  }
  throw new HttpError(400, `${label} must be an integer`)
}

const asOptionalInteger = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null || value === '') {
    return null
  }
  return asRequiredInteger(value, label)
}

const asObjectArray = (value: unknown, label: string): JsonBody[] => {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${label} must be an array`)
  }

  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new HttpError(400, `${label}[${index}] must be an object`)
    }
    return item as JsonBody
  })
}

const asDateOnly = (value: string, label: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${label} must be YYYY-MM-DD`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  const normalized = date.toISOString().slice(0, 10)
  if (normalized !== value) {
    throw new HttpError(400, `${label} is invalid`)
  }
  return value
}

const asIsoDateTime = (value: string, label: string): string => {
  const epoch = Date.parse(value)
  if (Number.isNaN(epoch)) {
    throw new HttpError(400, `${label} must be a valid datetime`)
  }
  return new Date(epoch).toISOString()
}

const buildDateRange = (startDate: string, endDate: string): string[] => {
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)

  if (start.getTime() > end.getTime()) {
    throw new HttpError(400, 'startDate must be before or equal to endDate')
  }

  const dates: string[] = []
  const cursor = new Date(start.getTime())
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (dates.length > 120) {
      throw new HttpError(400, 'Trip length is limited to 120 days')
    }
  }
  return dates
}

const getClient = (env: Env): Client =>
  createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  })

const mustTripExist = async (client: Client, tripId: string): Promise<void> => {
  const result = await client.execute({
    sql: 'SELECT id FROM trips WHERE id = ?',
    args: [tripId],
  })
  if (result.rows.length === 0) {
    throw new HttpError(404, 'Trip not found')
  }
}

const rowsAffected = (value: unknown): number => {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  return 0
}

interface ResponsePayload {
  ok: boolean
  [key: string]: unknown
}

const getNextDayNo = async (client: Client, tripId: string): Promise<number> => {
  const result = await client.execute({
    sql: 'SELECT COALESCE(MAX(day_no), 0) + 1 AS next_day_no FROM days WHERE trip_id = ?',
    args: [tripId],
  })
  const value = result.rows[0]?.next_day_no
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  return 1
}

const ensureDayBelongsToTrip = async (client: Client, dayId: string, tripId: string): Promise<void> => {
  const result = await client.execute({
    sql: 'SELECT id FROM days WHERE id = ? AND trip_id = ?',
    args: [dayId, tripId],
  })
  if (result.rows.length === 0) {
    throw new HttpError(400, 'dayId does not belong to trip')
  }
}

const fetchById = async (
  client: Client,
  table: 'days' | 'plans' | 'expenses' | 'flights' | 'hotels',
  id: string,
): Promise<ResponsePayload> => {
  const result = await client.execute({
    sql: `SELECT * FROM ${table} WHERE id = ?`,
    args: [id],
  })
  if (result.rows.length === 0) {
    throw new HttpError(404, `${table} item not found`)
  }
  return { ok: true, item: result.rows[0] }
}

interface AviationstackFlightItem {
  flight_date?: string
  departure?: {
    iata?: string | null
    airport?: string | null
    scheduled?: string | null
  }
  arrival?: {
    iata?: string | null
    airport?: string | null
    scheduled?: string | null
  }
  airline?: {
    name?: string | null
    iata?: string | null
  }
  flight?: {
    iata?: string | null
    number?: string | null
  }
}

const normalizeFlightIata = (value: string): string => value.trim().toUpperCase()

const normalizeDateParam = (value: string): string => asDateOnly(value, 'date')

const handleFlightLookup = async (request: Request, env: Env): Promise<ResponsePayload> => {
  const url = new URL(request.url)
  const rawFlightIata = url.searchParams.get('flightIata') ?? ''
  const rawDate = url.searchParams.get('date') ?? ''
  const flightIata = normalizeFlightIata(rawFlightIata)
  const date = rawDate ? normalizeDateParam(rawDate) : ''

  if (!flightIata || !/^[A-Z0-9]{3,8}$/.test(flightIata)) {
    throw new HttpError(400, 'flightIata query is required (e.g. KE123)')
  }

  const accessKey = env.AVIATIONSTACK_ACCESS_KEY
  if (!accessKey) {
    throw new HttpError(501, 'AVIATIONSTACK_ACCESS_KEY is not configured')
  }

  const apiUrl = new URL('https://api.aviationstack.com/v1/flights')
  apiUrl.searchParams.set('access_key', accessKey)
  apiUrl.searchParams.set('flight_iata', flightIata)
  if (date) {
    apiUrl.searchParams.set('flight_date', date)
  }

  const response = await fetch(apiUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new HttpError(502, `Flight provider error: ${response.status}`)
  }

  const payload = (await response.json()) as { data?: unknown }
  const rows = Array.isArray(payload.data) ? (payload.data as AviationstackFlightItem[]) : []
  if (rows.length === 0) {
    throw new HttpError(404, 'No matching flight found')
  }

  const matched =
    rows.find((item) => normalizeFlightIata(item.flight?.iata ?? '') === flightIata) ?? rows[0]

  const departAt = asOptionalString(matched.departure?.scheduled ?? null, 'departure.scheduled')
  const arriveAt = asOptionalString(matched.arrival?.scheduled ?? null, 'arrival.scheduled')
  const fromCode = asOptionalString(matched.departure?.iata ?? null, 'departure.iata')
  const toCode = asOptionalString(matched.arrival?.iata ?? null, 'arrival.iata')
  const airlineName = asOptionalString(matched.airline?.name ?? null, 'airline.name')
  const airlineCode = asOptionalString(matched.airline?.iata ?? null, 'airline.iata')
  const flightNumber = asOptionalString(matched.flight?.number ?? null, 'flight.number')

  return {
    ok: true,
    item: {
      flightIata,
      date: date || matched.flight_date || null,
      fromCode,
      toCode,
      departAt,
      arriveAt,
      airline: airlineName ?? airlineCode,
      flightNo: flightNumber ? `${airlineCode ?? ''}${flightNumber}`.trim() : flightIata,
      fromAirport: matched.departure?.airport ?? null,
      toAirport: matched.arrival?.airport ?? null,
      source: 'aviationstack',
    },
  }
}

const handleTripCreate = async (client: Client, body: JsonBody): Promise<ResponsePayload> => {
  const title = asRequiredString(valueOf(body, ['title']), 'title')
  const destination = asRequiredString(valueOf(body, ['destination']), 'destination')
  const startDate = asDateOnly(
    asRequiredString(valueOf(body, ['startDate', 'start_date']), 'startDate'),
    'startDate',
  )
  const endDate = asDateOnly(
    asRequiredString(valueOf(body, ['endDate', 'end_date']), 'endDate'),
    'endDate',
  )
  const currency = asOptionalString(valueOf(body, ['currency']), 'currency') ?? 'JPY'
  const memo = asOptionalString(valueOf(body, ['memo']), 'memo')
  const rawStatus = asOptionalString(valueOf(body, ['status']), 'status') ?? 'draft'
  const flightsInput = asObjectArray(valueOf(body, ['flights']), 'flights')
  const hotelsInput = asObjectArray(valueOf(body, ['hotels']), 'hotels')
  if (!STATUS_VALUES.has(rawStatus)) {
    throw new HttpError(400, 'status must be one of draft, active, done')
  }

  const dates = buildDateRange(startDate, endDate)
  const createdAt = nowIso()
  const tripId = makeId('trip')

  const statements: Array<{ sql: string; args: unknown[] }> = [
    {
      sql: `
        INSERT INTO trips (
          id, title, destination, start_date, end_date,
          currency, memo, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [tripId, title, destination, startDate, endDate, currency, memo, rawStatus, createdAt, createdAt],
    },
  ]

  dates.forEach((date, index) => {
    statements.push({
      sql: `
        INSERT INTO days (
          id, trip_id, day_no, date, title, note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [makeId('day'), tripId, index + 1, date, null, null, createdAt, createdAt],
    })
  })

  flightsInput.forEach((flight, index) => {
    const legType = asOptionalString(valueOf(flight, ['legType', 'leg_type']), `flights[${index}].legType`) ?? 'multi'
    const legOrder =
      asOptionalInteger(valueOf(flight, ['legOrder', 'leg_order']), `flights[${index}].legOrder`) ??
      index + 1
    const fromCode = asRequiredString(valueOf(flight, ['fromCode', 'from_code']), `flights[${index}].fromCode`)
    const fromAirport = asOptionalString(valueOf(flight, ['fromAirport', 'from_airport']), `flights[${index}].fromAirport`)
    const toCode = asRequiredString(valueOf(flight, ['toCode', 'to_code']), `flights[${index}].toCode`)
    const toAirport = asOptionalString(valueOf(flight, ['toAirport', 'to_airport']), `flights[${index}].toAirport`)
    const departAt = asIsoDateTime(
      asRequiredString(valueOf(flight, ['departAt', 'depart_at']), `flights[${index}].departAt`),
      `flights[${index}].departAt`,
    )
    const arriveAt = asIsoDateTime(
      asRequiredString(valueOf(flight, ['arriveAt', 'arrive_at']), `flights[${index}].arriveAt`),
      `flights[${index}].arriveAt`,
    )
    const airline = asRequiredString(valueOf(flight, ['airline']), `flights[${index}].airline`)
    const flightNo = asRequiredString(valueOf(flight, ['flightNo', 'flight_no']), `flights[${index}].flightNo`)
    const price = asOptionalInteger(valueOf(flight, ['price']), `flights[${index}].price`)
    const flightCurrency =
      asOptionalString(valueOf(flight, ['currency']), `flights[${index}].currency`) ?? currency
    const note = asOptionalString(valueOf(flight, ['note']), `flights[${index}].note`)

    statements.push({
      sql: `
        INSERT INTO flights (
          id, trip_id, leg_type, leg_order, from_code, from_airport, to_code, to_airport, depart_at, arrive_at,
          airline, flight_no, price, currency, note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        makeId('flt'),
        tripId,
        legType,
        legOrder,
        fromCode,
        fromAirport,
        toCode,
        toAirport,
        departAt,
        arriveAt,
        airline,
        flightNo,
        price,
        flightCurrency,
        note,
        createdAt,
        createdAt,
      ],
    })
  })

  hotelsInput.forEach((hotel, index) => {
    const name = asRequiredString(valueOf(hotel, ['name']), `hotels[${index}].name`)
    const city = asRequiredString(valueOf(hotel, ['city']), `hotels[${index}].city`)
    const checkInDate = asDateOnly(
      asRequiredString(valueOf(hotel, ['checkInDate', 'check_in_date']), `hotels[${index}].checkInDate`),
      `hotels[${index}].checkInDate`,
    )
    const checkOutDate = asDateOnly(
      asRequiredString(valueOf(hotel, ['checkOutDate', 'check_out_date']), `hotels[${index}].checkOutDate`),
      `hotels[${index}].checkOutDate`,
    )
    const confirmationNo = asOptionalString(
      valueOf(hotel, ['confirmationNo', 'confirmation_no']),
      `hotels[${index}].confirmationNo`,
    )
    const totalPrice = asOptionalInteger(
      valueOf(hotel, ['totalPrice', 'total_price']),
      `hotels[${index}].totalPrice`,
    )
    const hotelCurrency = asOptionalString(valueOf(hotel, ['currency']), `hotels[${index}].currency`) ?? currency
    const note = asOptionalString(valueOf(hotel, ['note']), `hotels[${index}].note`)

    statements.push({
      sql: `
        INSERT INTO hotels (
          id, trip_id, name, city, check_in_date, check_out_date,
          confirmation_no, total_price, currency, note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        makeId('hotel'),
        tripId,
        name,
        city,
        checkInDate,
        checkOutDate,
        confirmationNo,
        totalPrice,
        hotelCurrency,
        note,
        createdAt,
        createdAt,
      ],
    })
  })

  await client.batch(statements, 'write')

  const [trip, days, flights, hotels] = await Promise.all([
    client.execute({ sql: 'SELECT * FROM trips WHERE id = ?', args: [tripId] }),
    client.execute({
      sql: 'SELECT * FROM days WHERE trip_id = ? ORDER BY day_no ASC',
      args: [tripId],
    }),
    client.execute({
      sql: 'SELECT * FROM flights WHERE trip_id = ? ORDER BY leg_order ASC, depart_at ASC, id ASC',
      args: [tripId],
    }),
    client.execute({
      sql: 'SELECT * FROM hotels WHERE trip_id = ? ORDER BY check_in_date ASC, id ASC',
      args: [tripId],
    }),
  ])

  return {
    ok: true,
    trip: trip.rows[0],
    days: days.rows,
    flights: flights.rows,
    hotels: hotels.rows,
  }
}

const listTripCollection = async (
  client: Client,
  tripId: string,
  resource: ResourceName,
): Promise<ResponsePayload> => {
  await mustTripExist(client, tripId)
  const result = await client.execute({
    sql: `SELECT * FROM ${resource} WHERE trip_id = ? ${RESOURCE_ORDER[resource]}`,
    args: [tripId],
  })
  return { ok: true, items: result.rows }
}

const createTripCollectionItem = async (
  client: Client,
  tripId: string,
  resource: ResourceName,
  body: JsonBody,
): Promise<ResponsePayload> => {
  await mustTripExist(client, tripId)
  const createdAt = nowIso()

  if (resource === 'days') {
    const date = asDateOnly(asRequiredString(valueOf(body, ['date']), 'date'), 'date')
    const dayNoValue = valueOf(body, ['dayNo', 'day_no'])
    const dayNo =
      dayNoValue === undefined || dayNoValue === null
        ? await getNextDayNo(client, tripId)
        : asRequiredInteger(dayNoValue, 'dayNo')

    const title = asOptionalString(valueOf(body, ['title']), 'title')
    const note = asOptionalString(valueOf(body, ['note']), 'note')
    const id = makeId('day')

    await client.execute({
      sql: `
        INSERT INTO days (
          id, trip_id, day_no, date, title, note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [id, tripId, dayNo, date, title, note, createdAt, createdAt],
    })

    return fetchById(client, 'days', id)
  }

  if (resource === 'plans') {
    const dayId = asRequiredString(valueOf(body, ['dayId', 'day_id']), 'dayId')
    const place = asRequiredString(valueOf(body, ['place']), 'place')
    await ensureDayBelongsToTrip(client, dayId, tripId)

    const id = makeId('plan')
    await client.execute({
      sql: `
        INSERT INTO plans (
          id, trip_id, day_id, start_min, end_min, place, detail,
          map_url, food, transport, cost_estimate, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id,
        tripId,
        dayId,
        asOptionalInteger(valueOf(body, ['startMin', 'start_min']), 'startMin'),
        asOptionalInteger(valueOf(body, ['endMin', 'end_min']), 'endMin'),
        place,
        asOptionalString(valueOf(body, ['detail']), 'detail'),
        asOptionalString(valueOf(body, ['mapUrl', 'map_url']), 'mapUrl'),
        asOptionalString(valueOf(body, ['food']), 'food'),
        asOptionalString(valueOf(body, ['transport']), 'transport'),
        asOptionalInteger(valueOf(body, ['costEstimate', 'cost_estimate']), 'costEstimate'),
        asOptionalInteger(valueOf(body, ['sortOrder', 'sort_order']), 'sortOrder') ?? 0,
        createdAt,
        createdAt,
      ],
    })

    return fetchById(client, 'plans', id)
  }

  if (resource === 'expenses') {
    const item = asRequiredString(valueOf(body, ['item']), 'item')
    const amount = asRequiredInteger(valueOf(body, ['amount']), 'amount')
    const spentAtRaw = asOptionalString(valueOf(body, ['spentAt', 'spent_at']), 'spentAt')
    const dayId = asOptionalString(valueOf(body, ['dayId', 'day_id']), 'dayId')
    if (dayId) {
      await ensureDayBelongsToTrip(client, dayId, tripId)
    }

    const id = makeId('exp')
    await client.execute({
      sql: `
        INSERT INTO expenses (
          id, trip_id, day_id, item, amount, currency, category, spent_at, note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id,
        tripId,
        dayId,
        item,
        amount,
        asOptionalString(valueOf(body, ['currency']), 'currency') ?? 'JPY',
        asOptionalString(valueOf(body, ['category']), 'category'),
        spentAtRaw ? asIsoDateTime(spentAtRaw, 'spentAt') : createdAt,
        asOptionalString(valueOf(body, ['note']), 'note'),
        createdAt,
        createdAt,
      ],
    })

    return fetchById(client, 'expenses', id)
  }

  if (resource === 'flights') {
    const id = makeId('flt')
    const legType = asOptionalString(valueOf(body, ['legType', 'leg_type']), 'legType') ?? 'multi'
    const legOrder = asOptionalInteger(valueOf(body, ['legOrder', 'leg_order']), 'legOrder') ?? 1
    const fromCode = asRequiredString(valueOf(body, ['fromCode', 'from_code']), 'fromCode')
    const fromAirport = asOptionalString(valueOf(body, ['fromAirport', 'from_airport']), 'fromAirport')
    const toCode = asRequiredString(valueOf(body, ['toCode', 'to_code']), 'toCode')
    const toAirport = asOptionalString(valueOf(body, ['toAirport', 'to_airport']), 'toAirport')
    await client.execute({
      sql: `
        INSERT INTO flights (
          id, trip_id, leg_type, leg_order, from_code, from_airport, to_code, to_airport, depart_at, arrive_at,
          airline, flight_no, price, currency, note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id,
        tripId,
        legType,
        legOrder,
        fromCode,
        fromAirport,
        toCode,
        toAirport,
        asIsoDateTime(
          asRequiredString(valueOf(body, ['departAt', 'depart_at']), 'departAt'),
          'departAt',
        ),
        asIsoDateTime(
          asRequiredString(valueOf(body, ['arriveAt', 'arrive_at']), 'arriveAt'),
          'arriveAt',
        ),
        asRequiredString(valueOf(body, ['airline']), 'airline'),
        asRequiredString(valueOf(body, ['flightNo', 'flight_no']), 'flightNo'),
        asOptionalInteger(valueOf(body, ['price']), 'price'),
        asOptionalString(valueOf(body, ['currency']), 'currency') ?? 'KRW',
        asOptionalString(valueOf(body, ['note']), 'note'),
        createdAt,
        createdAt,
      ],
    })

    return fetchById(client, 'flights', id)
  }

  const id = makeId('hotel')
  await client.execute({
    sql: `
      INSERT INTO hotels (
        id, trip_id, name, city, check_in_date, check_out_date,
        confirmation_no, total_price, currency, note, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      tripId,
      asRequiredString(valueOf(body, ['name']), 'name'),
      asRequiredString(valueOf(body, ['city']), 'city'),
      asDateOnly(
        asRequiredString(valueOf(body, ['checkInDate', 'check_in_date']), 'checkInDate'),
        'checkInDate',
      ),
      asDateOnly(
        asRequiredString(valueOf(body, ['checkOutDate', 'check_out_date']), 'checkOutDate'),
        'checkOutDate',
      ),
      asOptionalString(valueOf(body, ['confirmationNo', 'confirmation_no']), 'confirmationNo'),
      asOptionalInteger(valueOf(body, ['totalPrice', 'total_price']), 'totalPrice'),
      asOptionalString(valueOf(body, ['currency']), 'currency') ?? 'JPY',
      asOptionalString(valueOf(body, ['note']), 'note'),
      createdAt,
      createdAt,
    ],
  })

  return fetchById(client, 'hotels', id)
}

const handleTripPatch = async (client: Client, tripId: string, body: JsonBody): Promise<ResponsePayload> => {
  await mustTripExist(client, tripId)

  const sets: string[] = []
  const args: unknown[] = []

  if (hasAnyKey(body, ['title'])) {
    sets.push('title = ?')
    args.push(asRequiredString(valueOf(body, ['title']), 'title'))
  }
  if (hasAnyKey(body, ['destination'])) {
    sets.push('destination = ?')
    args.push(asRequiredString(valueOf(body, ['destination']), 'destination'))
  }
  if (hasAnyKey(body, ['startDate', 'start_date'])) {
    const value = asDateOnly(
      asRequiredString(valueOf(body, ['startDate', 'start_date']), 'startDate'),
      'startDate',
    )
    sets.push('start_date = ?')
    args.push(value)
  }
  if (hasAnyKey(body, ['endDate', 'end_date'])) {
    const value = asDateOnly(
      asRequiredString(valueOf(body, ['endDate', 'end_date']), 'endDate'),
      'endDate',
    )
    sets.push('end_date = ?')
    args.push(value)
  }
  if (hasAnyKey(body, ['currency'])) {
    sets.push('currency = ?')
    args.push(asRequiredString(valueOf(body, ['currency']), 'currency'))
  }
  if (hasAnyKey(body, ['memo'])) {
    sets.push('memo = ?')
    args.push(asOptionalString(valueOf(body, ['memo']), 'memo'))
  }
  if (hasAnyKey(body, ['status'])) {
    const status = asRequiredString(valueOf(body, ['status']), 'status')
    if (!STATUS_VALUES.has(status)) {
      throw new HttpError(400, 'status must be one of draft, active, done')
    }
    sets.push('status = ?')
    args.push(status)
  }

  if (sets.length === 0) {
    throw new HttpError(400, 'No fields to update')
  }

  sets.push('updated_at = ?')
  args.push(nowIso())
  args.push(tripId)

  await client.execute({
    sql: `UPDATE trips SET ${sets.join(', ')} WHERE id = ?`,
    args,
  })

  const result = await client.execute({ sql: 'SELECT * FROM trips WHERE id = ?', args: [tripId] })
  return { ok: true, trip: result.rows[0] }
}

const handleTripDetail = async (client: Client, tripId: string): Promise<ResponsePayload> => {
  const [trip, days, plans, expenses, flights, hotels] = await Promise.all([
    client.execute({ sql: 'SELECT * FROM trips WHERE id = ?', args: [tripId] }),
    client.execute({ sql: 'SELECT * FROM days WHERE trip_id = ? ORDER BY day_no ASC', args: [tripId] }),
    client.execute({
      sql: 'SELECT * FROM plans WHERE trip_id = ? ORDER BY sort_order ASC, start_min ASC, id ASC',
      args: [tripId],
    }),
    client.execute({
      sql: 'SELECT * FROM expenses WHERE trip_id = ? ORDER BY spent_at DESC, id DESC',
      args: [tripId],
    }),
    client.execute({
      sql: 'SELECT * FROM flights WHERE trip_id = ? ORDER BY leg_order ASC, depart_at ASC, id ASC',
      args: [tripId],
    }),
    client.execute({
      sql: 'SELECT * FROM hotels WHERE trip_id = ? ORDER BY check_in_date ASC, id ASC',
      args: [tripId],
    }),
  ])

  if (trip.rows.length === 0) {
    throw new HttpError(404, 'Trip not found')
  }

  return {
    ok: true,
    trip: trip.rows[0],
    days: days.rows,
    plans: plans.rows,
    expenses: expenses.rows,
    flights: flights.rows,
    hotels: hotels.rows,
  }
}

const handleResourcePatch = async (
  client: Client,
  resource: ResourceName,
  id: string,
  body: JsonBody,
): Promise<ResponsePayload> => {
  const sets: string[] = []
  const args: unknown[] = []

  const push = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`)
    args.push(value)
  }

  if (resource === 'days') {
    if (hasAnyKey(body, ['dayNo', 'day_no'])) {
      push('day_no', asRequiredInteger(valueOf(body, ['dayNo', 'day_no']), 'dayNo'))
    }
    if (hasAnyKey(body, ['date'])) {
      push('date', asDateOnly(asRequiredString(valueOf(body, ['date']), 'date'), 'date'))
    }
    if (hasAnyKey(body, ['title'])) {
      push('title', asOptionalString(valueOf(body, ['title']), 'title'))
    }
    if (hasAnyKey(body, ['note'])) {
      push('note', asOptionalString(valueOf(body, ['note']), 'note'))
    }
  }

  if (resource === 'plans') {
    if (hasAnyKey(body, ['dayId', 'day_id'])) {
      push('day_id', asRequiredString(valueOf(body, ['dayId', 'day_id']), 'dayId'))
    }
    if (hasAnyKey(body, ['startMin', 'start_min'])) {
      push('start_min', asOptionalInteger(valueOf(body, ['startMin', 'start_min']), 'startMin'))
    }
    if (hasAnyKey(body, ['endMin', 'end_min'])) {
      push('end_min', asOptionalInteger(valueOf(body, ['endMin', 'end_min']), 'endMin'))
    }
    if (hasAnyKey(body, ['place'])) {
      push('place', asRequiredString(valueOf(body, ['place']), 'place'))
    }
    if (hasAnyKey(body, ['detail'])) {
      push('detail', asOptionalString(valueOf(body, ['detail']), 'detail'))
    }
    if (hasAnyKey(body, ['mapUrl', 'map_url'])) {
      push('map_url', asOptionalString(valueOf(body, ['mapUrl', 'map_url']), 'mapUrl'))
    }
    if (hasAnyKey(body, ['food'])) {
      push('food', asOptionalString(valueOf(body, ['food']), 'food'))
    }
    if (hasAnyKey(body, ['transport'])) {
      push('transport', asOptionalString(valueOf(body, ['transport']), 'transport'))
    }
    if (hasAnyKey(body, ['costEstimate', 'cost_estimate'])) {
      push(
        'cost_estimate',
        asOptionalInteger(valueOf(body, ['costEstimate', 'cost_estimate']), 'costEstimate'),
      )
    }
    if (hasAnyKey(body, ['sortOrder', 'sort_order'])) {
      push('sort_order', asRequiredInteger(valueOf(body, ['sortOrder', 'sort_order']), 'sortOrder'))
    }
  }

  if (resource === 'expenses') {
    if (hasAnyKey(body, ['dayId', 'day_id'])) {
      push('day_id', asOptionalString(valueOf(body, ['dayId', 'day_id']), 'dayId'))
    }
    if (hasAnyKey(body, ['item'])) {
      push('item', asRequiredString(valueOf(body, ['item']), 'item'))
    }
    if (hasAnyKey(body, ['amount'])) {
      push('amount', asRequiredInteger(valueOf(body, ['amount']), 'amount'))
    }
    if (hasAnyKey(body, ['currency'])) {
      push('currency', asRequiredString(valueOf(body, ['currency']), 'currency'))
    }
    if (hasAnyKey(body, ['category'])) {
      push('category', asOptionalString(valueOf(body, ['category']), 'category'))
    }
    if (hasAnyKey(body, ['spentAt', 'spent_at'])) {
      const raw = asRequiredString(valueOf(body, ['spentAt', 'spent_at']), 'spentAt')
      push('spent_at', asIsoDateTime(raw, 'spentAt'))
    }
    if (hasAnyKey(body, ['note'])) {
      push('note', asOptionalString(valueOf(body, ['note']), 'note'))
    }
  }

  if (resource === 'flights') {
    if (hasAnyKey(body, ['legType', 'leg_type'])) {
      push('leg_type', asRequiredString(valueOf(body, ['legType', 'leg_type']), 'legType'))
    }
    if (hasAnyKey(body, ['legOrder', 'leg_order'])) {
      push('leg_order', asRequiredInteger(valueOf(body, ['legOrder', 'leg_order']), 'legOrder'))
    }
    if (hasAnyKey(body, ['fromCode', 'from_code'])) {
      push('from_code', asRequiredString(valueOf(body, ['fromCode', 'from_code']), 'fromCode'))
    }
    if (hasAnyKey(body, ['fromAirport', 'from_airport'])) {
      push('from_airport', asOptionalString(valueOf(body, ['fromAirport', 'from_airport']), 'fromAirport'))
    }
    if (hasAnyKey(body, ['toCode', 'to_code'])) {
      push('to_code', asRequiredString(valueOf(body, ['toCode', 'to_code']), 'toCode'))
    }
    if (hasAnyKey(body, ['toAirport', 'to_airport'])) {
      push('to_airport', asOptionalString(valueOf(body, ['toAirport', 'to_airport']), 'toAirport'))
    }
    if (hasAnyKey(body, ['departAt', 'depart_at'])) {
      const raw = asRequiredString(valueOf(body, ['departAt', 'depart_at']), 'departAt')
      push('depart_at', asIsoDateTime(raw, 'departAt'))
    }
    if (hasAnyKey(body, ['arriveAt', 'arrive_at'])) {
      const raw = asRequiredString(valueOf(body, ['arriveAt', 'arrive_at']), 'arriveAt')
      push('arrive_at', asIsoDateTime(raw, 'arriveAt'))
    }
    if (hasAnyKey(body, ['airline'])) {
      push('airline', asRequiredString(valueOf(body, ['airline']), 'airline'))
    }
    if (hasAnyKey(body, ['flightNo', 'flight_no'])) {
      push('flight_no', asRequiredString(valueOf(body, ['flightNo', 'flight_no']), 'flightNo'))
    }
    if (hasAnyKey(body, ['price'])) {
      push('price', asOptionalInteger(valueOf(body, ['price']), 'price'))
    }
    if (hasAnyKey(body, ['currency'])) {
      push('currency', asOptionalString(valueOf(body, ['currency']), 'currency'))
    }
    if (hasAnyKey(body, ['note'])) {
      push('note', asOptionalString(valueOf(body, ['note']), 'note'))
    }
  }

  if (resource === 'hotels') {
    if (hasAnyKey(body, ['name'])) {
      push('name', asRequiredString(valueOf(body, ['name']), 'name'))
    }
    if (hasAnyKey(body, ['city'])) {
      push('city', asRequiredString(valueOf(body, ['city']), 'city'))
    }
    if (hasAnyKey(body, ['checkInDate', 'check_in_date'])) {
      const raw = asRequiredString(valueOf(body, ['checkInDate', 'check_in_date']), 'checkInDate')
      push('check_in_date', asDateOnly(raw, 'checkInDate'))
    }
    if (hasAnyKey(body, ['checkOutDate', 'check_out_date'])) {
      const raw = asRequiredString(valueOf(body, ['checkOutDate', 'check_out_date']), 'checkOutDate')
      push('check_out_date', asDateOnly(raw, 'checkOutDate'))
    }
    if (hasAnyKey(body, ['confirmationNo', 'confirmation_no'])) {
      push(
        'confirmation_no',
        asOptionalString(valueOf(body, ['confirmationNo', 'confirmation_no']), 'confirmationNo'),
      )
    }
    if (hasAnyKey(body, ['totalPrice', 'total_price'])) {
      push('total_price', asOptionalInteger(valueOf(body, ['totalPrice', 'total_price']), 'totalPrice'))
    }
    if (hasAnyKey(body, ['currency'])) {
      push('currency', asOptionalString(valueOf(body, ['currency']), 'currency'))
    }
    if (hasAnyKey(body, ['note'])) {
      push('note', asOptionalString(valueOf(body, ['note']), 'note'))
    }
  }

  if (sets.length === 0) {
    throw new HttpError(400, 'No fields to update')
  }

  push('updated_at', nowIso())
  args.push(id)

  const result = await client.execute({
    sql: `UPDATE ${resource} SET ${sets.join(', ')} WHERE id = ?`,
    args,
  })
  if (rowsAffected(result.rowsAffected) === 0) {
    throw new HttpError(404, `${resource} item not found`)
  }

  return fetchById(client, resource, id)
}

const handleResourceDelete = async (
  client: Client,
  resource: ResourceName,
  id: string,
): Promise<ResponsePayload> => {
  const result = await client.execute({
    sql: `DELETE FROM ${resource} WHERE id = ?`,
    args: [id],
  })
  if (rowsAffected(result.rowsAffected) === 0) {
    throw new HttpError(404, `${resource} item not found`)
  }
  return { ok: true, deleted: true, id }
}

const handleMetaGet = async (client: Client, key: string): Promise<ResponsePayload> => {
  const result = await client.execute({
    sql: 'SELECT key, value, updated_at FROM app_meta WHERE key = ?',
    args: [key],
  })
  if (result.rows.length === 0) {
    throw new HttpError(404, 'Meta key not found')
  }
  return { ok: true, item: result.rows[0] }
}

const handleMetaPut = async (client: Client, key: string, body: JsonBody): Promise<ResponsePayload> => {
  if (!hasAnyKey(body, ['value'])) {
    throw new HttpError(400, 'value is required')
  }

  const value = body.value
  const updatedAt = nowIso()
  await client.execute({
    sql: `
      INSERT INTO app_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    args: [key, JSON.stringify(value), updatedAt],
  })

  const result = await client.execute({
    sql: 'SELECT key, value, updated_at FROM app_meta WHERE key = ?',
    args: [key],
  })
  return { ok: true, item: result.rows[0] }
}

const routeProtected = async (
  request: Request,
  client: Client,
  env: Env,
  path: string,
): Promise<ResponsePayload> => {
  const method = request.method.toUpperCase()

  if (path === '/api/flight-lookup' && method === 'GET') {
    return handleFlightLookup(request, env)
  }

  if (path === '/api/trips' && method === 'GET') {
    const result = await client.execute('SELECT * FROM trips ORDER BY updated_at DESC')
    return { ok: true, items: result.rows }
  }

  if (path === '/api/trips' && method === 'POST') {
    const body = await readJson(request)
    return handleTripCreate(client, body)
  }

  const tripMatch = path.match(/^\/api\/trips\/([^/]+)$/)
  if (tripMatch) {
    const tripId = decodeSegment(tripMatch[1])
    if (method === 'GET') {
      return handleTripDetail(client, tripId)
    }
    if (method === 'PATCH') {
      const body = await readJson(request)
      return handleTripPatch(client, tripId, body)
    }
    if (method === 'DELETE') {
      const result = await client.execute({ sql: 'DELETE FROM trips WHERE id = ?', args: [tripId] })
      if (rowsAffected(result.rowsAffected) === 0) {
        throw new HttpError(404, 'Trip not found')
      }
      return { ok: true, deleted: true, id: tripId }
    }
    throw new HttpError(405, 'Method not allowed')
  }

  const tripCollectionMatch = path.match(/^\/api\/trips\/([^/]+)\/(days|plans|expenses|flights|hotels)$/)
  if (tripCollectionMatch) {
    const tripId = decodeSegment(tripCollectionMatch[1])
    const resource = tripCollectionMatch[2] as ResourceName

    if (method === 'GET') {
      return listTripCollection(client, tripId, resource)
    }
    if (method === 'POST') {
      const body = await readJson(request)
      return createTripCollectionItem(client, tripId, resource, body)
    }
    throw new HttpError(405, 'Method not allowed')
  }

  const resourceItemMatch = path.match(/^\/api\/(days|plans|expenses|flights|hotels)\/([^/]+)$/)
  if (resourceItemMatch) {
    const resource = resourceItemMatch[1] as ResourceName
    const itemId = decodeSegment(resourceItemMatch[2])

    if (method === 'PATCH') {
      const body = await readJson(request)
      return handleResourcePatch(client, resource, itemId, body)
    }
    if (method === 'DELETE') {
      return handleResourceDelete(client, resource, itemId)
    }
    throw new HttpError(405, 'Method not allowed')
  }

  const metaMatch = path.match(/^\/api\/meta\/([^/]+)$/)
  if (metaMatch) {
    const key = decodeSegment(metaMatch[1])
    if (method === 'GET') {
      return handleMetaGet(client, key)
    }
    if (method === 'PUT') {
      const body = await readJson(request)
      return handleMetaPut(client, key, body)
    }
    throw new HttpError(405, 'Method not allowed')
  }

  throw new HttpError(404, 'Not found')
}

const handleAuthVerify = async (request: Request, env: Env): Promise<ResponsePayload> => {
  const body = await readJson(request)
  const password = asRequiredString(valueOf(body, ['password']), 'password')
  if (password !== env.APP_PASSWORD) {
    throw new HttpError(401, 'Invalid password')
  }
  return { ok: true }
}

const mapDbError = (error: unknown): HttpError => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  if (error instanceof HttpError) {
    return error
  }
  if (message.includes('UNIQUE constraint failed')) {
    return new HttpError(409, message)
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new HttpError(400, message)
  }
  return new HttpError(500, 'Internal server error')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGIN)
    const corsHeaders = buildCorsHeaders(request, allowedOrigins)
    const method = request.method.toUpperCase()
    const path = normalizePath(new URL(request.url).pathname)
    const origin = request.headers.get('origin')

    if (origin && !isOriginAllowed(origin, allowedOrigins)) {
      return errorJson(403, 'Origin not allowed', corsHeaders)
    }

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    try {
      if (path === '/health' && method === 'GET') {
        return json({ ok: true, service: 'travel-api', now: nowIso() }, 200, corsHeaders)
      }

      if (path === '/auth/verify' && method === 'POST') {
        const payload = await handleAuthVerify(request, env)
        return json(payload, 200, corsHeaders)
      }

      requireAuth(request, env)
      const client = getClient(env)
      const payload = await routeProtected(request, client, env, path)
      return json(payload, 200, corsHeaders)
    } catch (error) {
      const normalized = mapDbError(error)
      return errorJson(normalized.status, normalized.message, corsHeaders)
    }
  },
}
