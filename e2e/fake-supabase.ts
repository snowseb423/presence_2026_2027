// Faux Supabase pour les tests : REST (PostgREST), RPC last-write-wins,
// Auth et Realtime (protocole Phoenix v2), le tout en mémoire.
import type { BrowserContext, Page, WebSocketRoute } from '@playwright/test'

type Row = Record<string, unknown>

export const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'alice@example.com' }
export const OTHER = { id: '00000000-0000-4000-8000-00000000000b', email: 'bob@example.com' }
const ORIGIN = 'http://supabase.e2e'

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

const ACCESS_TOKEN = [
  base64url({ alg: 'HS256', typ: 'JWT' }),
  base64url({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp: 4_102_444_800 }),
  'e2e-signature',
].join('.')

const SESSION = {
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4_102_444_800,
  refresh_token: 'e2e-refresh',
  user: {
    id: USER.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: USER.email,
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-09-01T00:00:00Z',
  },
}

const COLUMNS: Record<string, { name: string; type: string }[]> = {
  attendance_overrides: [
    { name: 'date', type: 'date' },
    { name: 'status_code', type: 'text' },
    { name: 'hours_override', type: 'numeric' },
    { name: 'comment', type: 'text' },
    { name: 'updated_by', type: 'uuid' },
    { name: 'updated_at', type: 'timestamptz' },
  ],
}

export class FakeSupabase {
  settings: Row = {
    id: 1,
    hourly_rate: 170,
    hours_per_day: 3,
    transport_per_day: 48,
    work_days: [1, 2, 3, 4, 5],
    period_start: '2026-09-01',
    period_end: '2027-12-31',
    employee_name: 'Marie',
    updated_by: null,
    updated_at: '2026-09-01T00:00:00Z',
  }
  statusRules: Row[] = [
    ['travaille', 'Travaillé', 3, true, 'olive', 10],
    ['demi_journee', 'Demi-journée', 1.5, true, 'amber', 20],
    ['conge_non_paye', 'Congé non payé', 0, false, 'coral', 30],
    ['absence_non_payee', 'Absence non payée', 0, false, 'brick', 40],
    ['jour_supplementaire', 'Jour supplémentaire', 3, true, 'lagoon', 50],
    ['conge_paye', 'Congé payé', 3, false, 'plum', 60],
    ['ferie_non_paye', 'Férié (non payé)', 0, false, 'slate', 70],
    ['ferie_paye', 'Férié (payé)', 3, false, 'steel', 80],
    ['week_end', 'Week-end', 0, false, 'stone', 90],
    ['non_concerne', 'Non concerné', 0, false, 'mist', 100],
  ].map(([code, label, paid_hours, transport_paid, color_token, sort_order]) => ({
    code,
    label,
    paid_hours,
    transport_paid,
    color_token,
    sort_order,
    updated_at: '2026-09-01T00:00:00Z',
  }))
  holidays: Row[] = [
    { date: '2026-11-02', name: 'Arrivée des travailleurs engagés', note: null, updated_by: null, updated_at: '2026-09-01T00:00:00Z' },
  ]
  overrides = new Map<string, Row>()
  members: Row[] = [
    { email: USER.email, display_name: 'Alice', user_id: USER.id },
    { email: OTHER.email, display_name: 'Bob', user_id: OTHER.id },
  ]
  /** Appels RPC reçus, dans l'ordre. */
  rpcCalls: { fn: string; args: Row }[] = []
  private sockets = new Set<WebSocketRoute>()
  private joined: { socket: WebSocketRoute; topic: string; ids: Map<string, number> }[] = []

  /** Session enregistrée avant le chargement : l'app démarre connectée. */
  async signIn(context: BrowserContext): Promise<void> {
    await context.addInitScript(
      ({ session, user }) => {
        localStorage.setItem('presence-auth', JSON.stringify(session))
        localStorage.setItem('presence:last-user', JSON.stringify(user))
      },
      { session: SESSION, user: USER },
    )
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route(`${ORIGIN}/**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(body),
        })

      if (request.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          },
        })
      }
      if (url.pathname.startsWith('/auth/v1/')) {
        if (url.pathname.endsWith('/user')) return json(SESSION.user)
        return json(SESSION)
      }
      const table = url.pathname.replace('/rest/v1/', '')
      if (request.method() === 'GET') {
        switch (table) {
          case 'settings':
            return json([this.settings])
          case 'status_rules':
            return json(this.statusRules)
          case 'holidays':
            return json(this.holidays)
          case 'attendance_overrides':
            return json([...this.overrides.values()])
          case 'allowed_emails':
            return json(this.members)
        }
      }
      if (request.method() === 'POST' && table.startsWith('rpc/')) {
        const fn = table.slice(4)
        const args = request.postDataJSON() as Row
        this.rpcCalls.push({ fn, args })
        return json(this.applyRpc(fn, args))
      }
      return json({ message: `non simulé : ${request.method()} ${url.pathname}` }, 404)
    })

    await context.routeWebSocket(/supabase\.e2e\/realtime\/v1\/websocket/, (socket) => {
      this.sockets.add(socket)
      socket.onClose(() => {
        this.sockets.delete(socket)
        this.joined = this.joined.filter((j) => j.socket !== socket)
      })
      socket.onMessage((raw) => {
        const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw)) as [
          string | null,
          string | null,
          string,
          string,
          Row,
        ]
        const reply = (response: Row) =>
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]))
        if (event === 'heartbeat' || event === 'access_token') return reply({})
        if (event === 'phx_leave') return reply({})
        if (event === 'phx_join') {
          const config = (payload.config ?? {}) as { postgres_changes?: { event: string; schema: string; table: string }[] }
          const bindings = (config.postgres_changes ?? []).map((binding, index) => ({ ...binding, id: index + 1 }))
          this.joined.push({
            socket,
            topic,
            ids: new Map(bindings.map((binding) => [String(binding.table), binding.id])),
          })
          return reply({ postgres_changes: bindings })
        }
        return undefined
      })
    })
  }

  private applyRpc(fn: string, args: Row): Row | null {
    const date = String(args.p_date)
    const at = String(args.p_updated_at)
    const current = this.overrides.get(date)
    const newer = current && Date.parse(String(current.updated_at)) > Date.parse(at)
    if (fn === 'set_attendance' && !newer) {
      this.overrides.set(date, {
        date,
        status_code: args.p_status_code,
        hours_override: args.p_hours_override ?? null,
        comment: args.p_comment ?? null,
        updated_by: USER.id,
        updated_at: at,
      })
    }
    if (fn === 'clear_attendance' && !newer) this.overrides.delete(date)
    return this.overrides.get(date) ?? null
  }

  /** Nombre d'abonnements temps réel actifs. */
  get channels(): number {
    return this.joined.length
  }

  /**
   * Simule une saisie faite sur l'autre téléphone. `persist: false` : envoyée
   * uniquement par le temps réel (une relecture REST ne la verrait pas).
   */
  pushOverride(row: Row, { persist = true }: { persist?: boolean } = {}): void {
    if (persist) this.overrides.set(String(row.date), row)
    for (const { socket, topic, ids } of this.joined) {
      const id = ids.get('attendance_overrides')
      socket.send(
        JSON.stringify([
          null,
          null,
          topic,
          'postgres_changes',
          {
            ids: [id],
            data: {
              type: 'INSERT',
              schema: 'public',
              table: 'attendance_overrides',
              commit_timestamp: new Date().toISOString(),
              errors: null,
              columns: COLUMNS.attendance_overrides,
              record: row,
            },
          },
        ]),
      )
    }
  }
}

/** Fige la date du navigateur (lundi 12 octobre 2026, 9 h à Maurice). */
export async function freezeClock(page: Page, iso = '2026-10-12T09:00:00+04:00'): Promise<void> {
  await page.clock.setFixedTime(new Date(iso))
}
